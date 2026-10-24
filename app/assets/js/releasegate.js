/**
 * Release gate for Portalbound.
 *
 * Keeps the play button locked until the portal opens and unlocks it
 * automatically once it does. The website's /api/launch endpoint is the
 * source of truth, it is evaluated on the server so a wrong local clock
 * can't open the portal early. If the website can't be reached, the local
 * clock is compared against the release date instead.
 *
 * The release date itself is read from the website (the same value that
 * drives the countdown on portalbound.xyz), then from the distribution
 * index, then from DEFAULT_RELEASE_AT.
 */
const got            = require('got')
const { LoggerUtil } = require('helios-core')
const isDev          = require('./isdev')

const logger = LoggerUtil.getLogger('ReleaseGate')

// Keep in sync with https://portalbound.xyz (launchAt).
exports.DEFAULT_RELEASE_AT = '2027-01-01T13:00:00+01:00'
exports.WEBSITE_URL        = 'https://portalbound.xyz/'
exports.LAUNCH_API_URL     = 'https://portalbound.xyz/api/launch'

const SECOND = 1000
const MINUTE = 60 * SECOND

// How often /api/launch is asked, depending on how close the release is.
const POLL_FAR  = 10 * MINUTE
const POLL_NEAR = 30 * SECOND
const POLL_DUE  = 10 * SECOND
const NEAR_WINDOW = 15 * MINUTE

// How often the release date is re-read from the website.
const RELEASE_DATE_REFRESH = 60 * MINUTE

const REQUEST_TIMEOUT = 5000

/**
 * Possible states of the gate.
 */
exports.STATE = {
    // Countdown is running.
    LOCKED: 'locked',
    // Countdown is over, but the website still says the portal is closed.
    DUE: 'due',
    // Play button is free.
    UNLOCKED: 'unlocked'
}

let releaseAt = Date.parse(exports.DEFAULT_RELEASE_AT)
let launchApiUrl = exports.LAUNCH_API_URL
let forceUnlock = false

// true / false from the API, null while unknown or unreachable.
let apiLive = null
// Once unlocked, the gate stays open for the rest of the session.
let unlocked = false
// The website's date wins over the one from the distribution index.
let releaseDateFromWebsite = false

let listeners = []
let tickTimer = null
let pollTimer = null
let releaseDateTimer = null
let started = false

// Development overrides, e.g. to test the moment of release:
//   PORTALBOUND_RELEASE_AT=+30            release 30 seconds from now
//   PORTALBOUND_LAUNCH_API=http://127.0.0.1:9/   simulate an unreachable API
//   PORTALBOUND_FORCE_UNLOCK=1            skip the gate entirely
if(isDev){
    const devRelease = process.env.PORTALBOUND_RELEASE_AT
    if(devRelease){
        const parsed = devRelease.startsWith('+')
            ? Date.now() + Number.parseInt(devRelease.substring(1), 10) * SECOND
            : Date.parse(devRelease)
        if(!Number.isNaN(parsed)){
            releaseAt = parsed
            logger.info('Using development release date', new Date(releaseAt).toISOString())
        }
    }
    if(process.env.PORTALBOUND_LAUNCH_API){
        launchApiUrl = process.env.PORTALBOUND_LAUNCH_API
    }
    forceUnlock = process.env.PORTALBOUND_FORCE_UNLOCK === '1'
}
const releaseAtLocked = isDev && process.env.PORTALBOUND_RELEASE_AT != null

/**
 * @returns {number} The release date as a timestamp (ms).
 */
exports.getReleaseAt = function(){
    return releaseAt
}

/**
 * @returns {boolean} True if the play button may be used.
 */
exports.isUnlocked = function(){
    return unlocked
}

/**
 * @returns {string} The current state, one of STATE.
 */
exports.getState = function(){
    if(unlocked){
        return exports.STATE.UNLOCKED
    }
    return Date.now() >= releaseAt ? exports.STATE.DUE : exports.STATE.LOCKED
}

/**
 * Split the remaining time into days, hours, minutes and seconds.
 *
 * @returns {{total: number, days: number, hours: number, minutes: number, seconds: number}}
 */
exports.getRemaining = function(){
    const total = Math.max(0, releaseAt - Date.now())
    return {
        total,
        days: Math.floor(total / (24 * 60 * MINUTE)),
        hours: Math.floor(total % (24 * 60 * MINUTE) / (60 * MINUTE)),
        minutes: Math.floor(total % (60 * MINUTE) / MINUTE),
        seconds: Math.floor(total % MINUTE / SECOND)
    }
}

/**
 * Register a listener which is called every second and whenever
 * the state changes.
 *
 * @param {function(string, Object): void} listener Receives the state and the remaining time.
 */
exports.onUpdate = function(listener){
    listeners.push(listener)
}

/**
 * Use the release date from the distribution index, unless the website
 * already provided one.
 *
 * @param {string} value An ISO 8601 date.
 */
exports.setFallbackReleaseAt = function(value){
    if(value == null || releaseAtLocked || releaseDateFromWebsite){
        return
    }
    const parsed = Date.parse(value)
    if(!Number.isNaN(parsed)){
        releaseAt = parsed
        evaluate()
    }
}

/**
 * Start the countdown and polling. Safe to call more than once.
 */
exports.start = function(){
    if(started){
        return
    }
    started = true

    if(forceUnlock){
        logger.info('Release gate disabled by PORTALBOUND_FORCE_UNLOCK.')
        unlocked = true
        notify()
        return
    }

    tickTimer = setInterval(evaluate, SECOND)
    refreshReleaseDate()
    releaseDateTimer = setInterval(refreshReleaseDate, RELEASE_DATE_REFRESH)
    poll()
}

/**
 * Ask the website right now, e.g. when the user clicks the locked button.
 */
exports.refresh = function(){
    if(!unlocked){
        poll()
    }
}

function notify(){
    const state = exports.getState()
    const remaining = exports.getRemaining()
    for(const listener of listeners){
        try {
            listener(state, remaining)
        } catch(err) {
            logger.error('Release gate listener failed', err)
        }
    }
}

function evaluate(){
    if(!unlocked){
        const now = Date.now()
        if(apiLive === true || (apiLive == null && now >= releaseAt)){
            unlock(apiLive === true ? 'website reports the portal as open' : 'release date reached, website unreachable')
            return
        }
    }
    notify()
}

function unlock(reason){
    if(unlocked){
        return
    }
    unlocked = true
    logger.info(`Portal is open (${reason}).`)
    clearInterval(tickTimer)
    clearInterval(releaseDateTimer)
    clearTimeout(pollTimer)
    notify()
}

function nextPollDelay(){
    const remaining = releaseAt - Date.now()
    if(remaining <= 0){
        return POLL_DUE
    }
    if(remaining <= NEAR_WINDOW){
        return Math.min(POLL_NEAR, remaining + SECOND)
    }
    return Math.min(POLL_FAR, remaining - NEAR_WINDOW + SECOND)
}

async function poll(){
    clearTimeout(pollTimer)
    try {
        const res = await got.get(launchApiUrl, {
            responseType: 'json',
            timeout: REQUEST_TIMEOUT,
            retry: 0
        })
        apiLive = res.body?.live === true
    } catch(err) {
        logger.warn('Unable to reach the launch status endpoint, falling back to the local clock.')
        logger.debug(err)
        apiLive = null
    }
    evaluate()
    if(!unlocked){
        pollTimer = setTimeout(poll, nextPollDelay())
    }
}

async function refreshReleaseDate(){
    if(releaseAtLocked){
        return
    }
    try {
        const res = await got.get(exports.WEBSITE_URL, {
            timeout: REQUEST_TIMEOUT,
            retry: 0
        })
        // The website ships its public runtime config inline, e.g. launchAt:"2027-01-01T13:00:00+01:00"
        const match = /launchAt:"([^"]+)"/.exec(res.body)
        const parsed = match != null ? Date.parse(match[1]) : Number.NaN
        if(!Number.isNaN(parsed)){
            if(parsed !== releaseAt){
                logger.info('Release date from website', match[1])
            }
            releaseAt = parsed
            releaseDateFromWebsite = true
            evaluate()
            if(!unlocked){
                // The poll interval depends on the release date.
                clearTimeout(pollTimer)
                pollTimer = setTimeout(poll, nextPollDelay())
            }
        }
    } catch(err) {
        logger.debug('Unable to read the release date from the website.', err)
    }
}
