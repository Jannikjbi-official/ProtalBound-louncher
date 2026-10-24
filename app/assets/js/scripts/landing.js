/**
 * Script for landing.ejs
 */
// Requirements
const { URL }                 = require('url')
const {
    MojangRestAPI,
    getServerStatus
}                             = require('helios-core/mojang')
const {
    RestResponseStatus,
    isDisplayableError,
    validateLocalFile
}                             = require('helios-core/common')
const {
    FullRepair,
    DistributionIndexProcessor,
    MojangIndexProcessor,
    downloadFile
}                             = require('helios-core/dl')
const {
    validateSelectedJvm,
    ensureJavaDirIsRoot,
    javaExecFromRoot,
    discoverBestJvmInstallation,
    latestOpenJDK,
    extractJdk
}                             = require('helios-core/java')

// Internal Requirements
const DiscordWrapper          = require('./assets/js/discordwrapper')
const ProcessBuilder          = require('./assets/js/processbuilder')
const ReleaseGate             = require('./assets/js/releasegate')

// Launch Elements
const launch_content          = document.getElementById('launch_content')
const launch_details          = document.getElementById('launch_details')
const launch_progress         = document.getElementById('launch_progress')
const launch_progress_label   = document.getElementById('launch_progress_label')
const launch_details_text     = document.getElementById('launch_details_text')
const server_selection_button = document.getElementById('server_selection_button')
const user_text               = document.getElementById('user_text')

const loggerLanding = LoggerUtil.getLogger('Landing')

/* Launch Progress Wrapper Functions */

/**
 * Show/hide the loading area.
 * 
 * @param {boolean} loading True if the loading area should be shown, otherwise false.
 */
function toggleLaunchArea(loading){
    if(loading){
        launch_details.style.display = 'flex'
        launch_content.style.display = 'none'
    } else {
        launch_details.style.display = 'none'
        launch_content.style.display = 'inline-flex'
    }
}

/**
 * Set the details text of the loading area.
 * 
 * @param {string} details The new text for the loading details.
 */
function setLaunchDetails(details){
    launch_details_text.innerHTML = details
}

/**
 * Set the value of the loading progress bar and display that value.
 * 
 * @param {number} percent Percentage (0-100)
 */
function setLaunchPercentage(percent){
    launch_progress.setAttribute('max', 100)
    launch_progress.setAttribute('value', percent)
    launch_progress_label.innerHTML = percent + '%'
}

/**
 * Set the value of the OS progress bar and display that on the UI.
 * 
 * @param {number} percent Percentage (0-100)
 */
function setDownloadPercentage(percent){
    remote.getCurrentWindow().setProgressBar(percent/100)
    setLaunchPercentage(percent)
}

/**
 * Enable or disable the launch button.
 *
 * @param {boolean} val True to enable, false to disable.
 */
function setLaunchEnabled(val){
    document.getElementById('launch_button').disabled = !val
}

/* Release Gate */

const releaseGateDateFormat = new Intl.DateTimeFormat(Lang.queryJS('locale.intl'), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' })
const releaseGateTimeFormat = new Intl.DateTimeFormat(Lang.queryJS('locale.intl'), { hour: 'numeric', minute: '2-digit', timeZone: 'Europe/Berlin' })
let releaseGateLastState = null

/**
 * Format the release date for display, e.g. { date: 'January 1, 2027', time: '1:00 PM' }.
 */
function getReleaseGatePlaceholders(){
    const releaseAt = ReleaseGate.getReleaseAt()
    return {
        date: releaseGateDateFormat.format(releaseAt),
        time: releaseGateTimeFormat.format(releaseAt)
    }
}

/**
 * Show the "not open yet" overlay when the locked play button is clicked.
 */
function showReleaseGateLocked(){
    ReleaseGate.refresh()
    setOverlayContent(
        Lang.queryJS('landing.releaseGate.lockedTitle'),
        Lang.queryJS('landing.releaseGate.lockedText', getReleaseGatePlaceholders()),
        Lang.queryJS('landing.releaseGate.lockedOkay')
    )
    setOverlayHandler(null)
    toggleOverlay(true)
}

/**
 * Update the countdown and the play button for the given state.
 *
 * @param {string} state One of ReleaseGate.STATE.
 * @param {Object} remaining The remaining time until the release.
 */
function renderReleaseGate(state, remaining){
    const pad = v => String(v).padStart(2, '0')
    document.getElementById('releaseGateDays').innerHTML = pad(remaining.days)
    document.getElementById('releaseGateHours').innerHTML = pad(remaining.hours)
    document.getElementById('releaseGateMinutes').innerHTML = pad(remaining.minutes)
    document.getElementById('releaseGateSeconds').innerHTML = pad(remaining.seconds)

    const headline = state === ReleaseGate.STATE.LOCKED ? Lang.queryJS('landing.releaseGate.headlineLocked', getReleaseGatePlaceholders()) : null
    if(state === releaseGateLastState){
        // The release date may have been updated from the website.
        if(headline != null){
            document.getElementById('releaseGateHeadline').innerHTML = headline
        }
        return
    }
    const opened = releaseGateLastState != null && state === ReleaseGate.STATE.UNLOCKED
    releaseGateLastState = state

    const releaseGate = document.getElementById('releaseGate')
    const launchButton = document.getElementById('launch_button')
    releaseGate.setAttribute('state', state)
    switch(state){
        case ReleaseGate.STATE.LOCKED:
            document.getElementById('releaseGateHeadline').innerHTML = headline
            document.getElementById('releaseGateNote').innerHTML = Lang.queryJS('landing.releaseGate.noteLocked')
            launchButton.innerHTML = Lang.queryJS('landing.releaseGate.buttonLocked')
            launchButton.setAttribute('locked', '')
            break
        case ReleaseGate.STATE.DUE:
            document.getElementById('releaseGateHeadline').innerHTML = Lang.queryJS('landing.releaseGate.headlineDue')
            document.getElementById('releaseGateNote').innerHTML = Lang.queryJS('landing.releaseGate.noteDue')
            launchButton.innerHTML = Lang.queryJS('landing.releaseGate.buttonLocked')
            launchButton.setAttribute('locked', '')
            break
        case ReleaseGate.STATE.UNLOCKED:
            document.getElementById('releaseGateHeadline').innerHTML = Lang.queryJS('landing.releaseGate.headlineOpen')
            document.getElementById('releaseGateNote').innerHTML = Lang.queryJS('landing.releaseGate.noteOpen')
            launchButton.innerHTML = Lang.queryEJS('landing.launchButton')
            launchButton.removeAttribute('locked')
            if(opened){
                releaseGate.setAttribute('opened', '')
                const win = remote.getCurrentWindow()
                if(!win.isFocused()){
                    win.flashFrame(true)
                    new Notification(Lang.queryJS('landing.releaseGate.notificationTitle'), {
                        body: Lang.queryJS('landing.releaseGate.notificationBody')
                    }).onclick = () => {
                        win.show()
                        win.focus()
                    }
                }
            }
            break
    }
}

ReleaseGate.onUpdate(renderReleaseGate)
renderReleaseGate(ReleaseGate.getState(), ReleaseGate.getRemaining())
ReleaseGate.start()

/* Launcher Update Banner */

/**
 * Show the state of a launcher update at the top of the landing view.
 *
 * @param {string} state downloading, progress, ready (Windows/Linux) or manual (macOS).
 * @param {Object} info The update info, needs at least version.
 */
function setUpdateBanner(state, info){
    const banner = document.getElementById('updateBanner')
    const text = document.getElementById('updateBannerText')
    const action = document.getElementById('updateBannerAction')
    const version = info?.version ?? ''

    action.style.display = 'none'
    action.onclick = null
    switch(state){
        case 'downloading':
            text.textContent = Lang.queryJS('landing.update.downloading', { version })
            break
        case 'progress':
            text.textContent = Lang.queryJS('landing.update.progress', { version, percent: info.percent })
            break
        case 'ready':
            text.textContent = Lang.queryJS('landing.update.ready', { version })
            action.textContent = Lang.queryJS('landing.update.restart')
            action.style.display = null
            action.onclick = () => ipcRenderer.send('autoUpdateAction', 'installUpdateNow')
            break
        case 'manual':
            text.textContent = Lang.queryJS('landing.update.manual', { version })
            action.textContent = Lang.queryJS('landing.update.download')
            action.style.display = null
            action.onclick = () => shell.openExternal(info.darwindownload)
            break
    }
    banner.setAttribute('state', state)
    banner.style.display = 'flex'
}

/* Changelog */

const Changelog = require('./assets/js/changelog')

/**
 * Show the changelog dialog.
 *
 * @param {string | null} version Only this version (what's new), or null for the whole changelog.
 */
function showChangelogModal(version = null){
    const modal = document.getElementById('changelogModal')
    const body = document.getElementById('changelogBody')
    const entries = version == null ? Changelog.getEntries() : [Changelog.getEntry(version)].filter(Boolean)

    document.getElementById('changelogEyebrow').textContent = Lang.queryJS(version == null ? 'changelog.allEyebrow' : 'changelog.eyebrow')
    document.getElementById('changelogTitle').textContent = version == null
        ? Lang.queryJS('changelog.allTitle')
        : Lang.queryJS('changelog.title', { version }) + (entries[0]?.title ? ' · ' + entries[0].title : '')
    document.getElementById('changelogDone').textContent = Lang.queryJS('changelog.done')

    body.innerHTML = ''
    if(entries.length === 0){
        body.textContent = Lang.queryJS('changelog.empty')
    }
    for(const entry of entries){
        const section = document.createElement('section')
        section.className = 'changelogEntry'
        if(version == null){
            const heading = document.createElement('div')
            heading.className = 'changelogEntryHeading'
            const ver = document.createElement('span')
            ver.className = 'changelogEntryVersion'
            ver.textContent = 'v' + entry.version
            const meta = document.createElement('span')
            meta.className = 'changelogEntryMeta'
            meta.textContent = [entry.title, entry.date].filter(Boolean).join(' · ')
            heading.append(ver, meta)
            section.appendChild(heading)
        }
        const content = document.createElement('div')
        content.className = 'changelogEntryContent'
        // Rendered by markdown.js from the bundled CHANGELOG.md, which escapes all HTML.
        content.innerHTML = entry.html
        section.appendChild(content)
        body.appendChild(section)
    }
    body.scrollTop = 0
    $(modal).fadeIn(200)
}

function hideChangelogModal(){
    $('#changelogModal').fadeOut(200)
}

// The dialog lives in app.ejs after this script, bind it once the page is parsed.
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('changelogClose').onclick = hideChangelogModal
    document.getElementById('changelogDone').onclick = hideChangelogModal
    document.getElementById('changelogModal').onclick = (e) => {
        if(e.target.id === 'changelogModal'){
            hideChangelogModal()
        }
    }
})
document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape' && $('#changelogModal').is(':visible')){
        hideChangelogModal()
    }
})

/**
 * After the launcher was updated, show what changed in the new version once.
 */
function showWhatsNewIfUpdated(){
    const current = remote.app.getVersion()
    const lastSeen = ConfigManager.getLastSeenVersion()
    if(lastSeen === current){
        return
    }
    ConfigManager.setLastSeenVersion(current)
    ConfigManager.save()
    // Fresh installs start without a changelog popup.
    if(lastSeen != null && Changelog.getEntry(current) != null){
        showChangelogModal(current)
    }
}

// Bind launch button
document.getElementById('launch_button').addEventListener('click', async e => {
    if(!ReleaseGate.isUnlocked()){
        e.target.blur()
        showReleaseGateLocked()
        return
    }
    loggerLanding.info('Launching game..')
    try {
        const server = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
        const jExe = ConfigManager.getJavaExecutable(ConfigManager.getSelectedServer())
        if(jExe == null){
            await asyncSystemScan(server.effectiveJavaOptions)
        } else {

            setLaunchDetails(Lang.queryJS('landing.launch.pleaseWait'))
            toggleLaunchArea(true)
            setLaunchPercentage(0, 100)

            const details = await validateSelectedJvm(ensureJavaDirIsRoot(jExe), server.effectiveJavaOptions.supported)
            if(details != null){
                loggerLanding.info('Jvm Details', details)
                await dlAsync()

            } else {
                await asyncSystemScan(server.effectiveJavaOptions)
            }
        }
    } catch(err) {
        loggerLanding.error('Unhandled error in during launch process.', err)
        showLaunchFailure(Lang.queryJS('landing.launch.failureTitle'), Lang.queryJS('landing.launch.failureText'))
    }
})

// Bind settings button
document.getElementById('settingsMediaButton').onclick = async e => {
    await prepareSettings()
    switchView(getCurrentView(), VIEWS.settings)
}

// Bind avatar overlay button.
document.getElementById('avatarOverlay').onclick = async e => {
    await prepareSettings()
    switchView(getCurrentView(), VIEWS.settings, 500, 500, () => {
        settingsNavItemListener(document.getElementById('settingsNavAccount'), false)
    })
}

// Bind selected account
function updateSelectedAccount(authUser){
    let username = Lang.queryJS('landing.selectedAccount.noAccountSelected')
    if(authUser != null){
        if(authUser.displayName != null){
            username = authUser.displayName
        }
        if(authUser.uuid != null){
            document.getElementById('avatarContainer').style.backgroundImage = `url('https://mc-heads.net/body/${authUser.uuid}/right')`
        }
    }
    user_text.innerHTML = username
}
updateSelectedAccount(ConfigManager.getSelectedAccount())

// Bind selected server
function updateSelectedServer(serv){
    if(getCurrentView() === VIEWS.settings){
        fullSettingsSave()
    }
    ConfigManager.setSelectedServer(serv != null ? serv.rawServer.id : null)
    ConfigManager.save()
    server_selection_button.innerHTML = '&#8226; ' + (serv != null ? serv.rawServer.name : Lang.queryJS('landing.noSelection'))
    if(getCurrentView() === VIEWS.settings){
        animateSettingsTabRefresh()
    }
    setLaunchEnabled(serv != null)
}
// Real text is set in uibinder.js on distributionIndexDone.
server_selection_button.innerHTML = '&#8226; ' + Lang.queryJS('landing.selectedServer.loading')
server_selection_button.onclick = async e => {
    e.target.blur()
    await toggleServerSelection(true)
}

// Update Mojang Status Color
const refreshMojangStatuses = async function(){
    loggerLanding.info('Refreshing Mojang Statuses..')

    let status = 'grey'
    let tooltipEssentialHTML = ''
    let tooltipNonEssentialHTML = ''

    const response = await MojangRestAPI.status()
    let statuses
    if(response.responseStatus === RestResponseStatus.SUCCESS) {
        statuses = response.data
    } else {
        loggerLanding.warn('Unable to refresh Mojang service status.')
        statuses = MojangRestAPI.getDefaultStatuses()
    }
    
    greenCount = 0
    greyCount = 0

    for(let i=0; i<statuses.length; i++){
        const service = statuses[i]

        const tooltipHTML = `<div class="mojangStatusContainer">
            <span class="mojangStatusIcon" style="color: ${MojangRestAPI.statusToHex(service.status)};">&#8226;</span>
            <span class="mojangStatusName">${service.name}</span>
        </div>`
        if(service.essential){
            tooltipEssentialHTML += tooltipHTML
        } else {
            tooltipNonEssentialHTML += tooltipHTML
        }

        if(service.status === 'yellow' && status !== 'red'){
            status = 'yellow'
        } else if(service.status === 'red'){
            status = 'red'
        } else {
            if(service.status === 'grey'){
                ++greyCount
            }
            ++greenCount
        }

    }

    if(greenCount === statuses.length){
        if(greyCount === statuses.length){
            status = 'grey'
        } else {
            status = 'green'
        }
    }
    
    document.getElementById('mojangStatusEssentialContainer').innerHTML = tooltipEssentialHTML
    document.getElementById('mojangStatusNonEssentialContainer').innerHTML = tooltipNonEssentialHTML
    document.getElementById('mojang_status_icon').style.color = MojangRestAPI.statusToHex(status)
}

const refreshServerStatus = async (fade = false) => {
    loggerLanding.info('Refreshing Server Status')
    const serv = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())

    let pLabel = Lang.queryJS('landing.serverStatus.server')
    let pVal = Lang.queryJS('landing.serverStatus.offline')

    try {

        const servStat = await getServerStatus(47, serv.hostname, serv.port)
        console.log(servStat)
        pLabel = Lang.queryJS('landing.serverStatus.players')
        pVal = servStat.players.online + '/' + servStat.players.max

    } catch (err) {
        loggerLanding.warn('Unable to refresh server status, assuming offline.')
        loggerLanding.debug(err)
    }
    if(fade){
        $('#server_status_wrapper').fadeOut(250, () => {
            document.getElementById('landingPlayerLabel').innerHTML = pLabel
            document.getElementById('player_count').innerHTML = pVal
            $('#server_status_wrapper').fadeIn(500)
        })
    } else {
        document.getElementById('landingPlayerLabel').innerHTML = pLabel
        document.getElementById('player_count').innerHTML = pVal
    }
    
}

refreshMojangStatuses()
// Server Status is refreshed in uibinder.js on distributionIndexDone.

// Refresh statuses every hour. The status page itself refreshes every day so...
let mojangStatusListener = setInterval(() => refreshMojangStatuses(true), 60*60*1000)
// Set refresh rate to once every 5 minutes.
let serverStatusListener = setInterval(() => refreshServerStatus(true), 300000)

/**
 * Shows an error overlay, toggles off the launch area.
 * 
 * @param {string} title The overlay title.
 * @param {string} desc The overlay description.
 */
function showLaunchFailure(title, desc){
    setOverlayContent(
        title,
        desc,
        Lang.queryJS('landing.launch.okay')
    )
    setOverlayHandler(null)
    toggleOverlay(true)
    toggleLaunchArea(false)
}

/* System (Java) Scan */

/**
 * Asynchronously scan the system for valid Java installations.
 * 
 * @param {boolean} launchAfter Whether we should begin to launch after scanning. 
 */
async function asyncSystemScan(effectiveJavaOptions, launchAfter = true){

    setLaunchDetails(Lang.queryJS('landing.systemScan.checking'))
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)

    const jvmDetails = await discoverBestJvmInstallation(
        ConfigManager.getDataDirectory(),
        effectiveJavaOptions.supported
    )

    if(jvmDetails == null) {
        // If the result is null, no valid Java installation was found.
        // Show this information to the user.
        setOverlayContent(
            Lang.queryJS('landing.systemScan.noCompatibleJava'),
            Lang.queryJS('landing.systemScan.installJavaMessage', { 'major': effectiveJavaOptions.suggestedMajor }),
            Lang.queryJS('landing.systemScan.installJava'),
            Lang.queryJS('landing.systemScan.installJavaManually')
        )
        setOverlayHandler(() => {
            // Ignore further clicks while the overlay fades out, they would download Java twice.
            setOverlayHandler(() => {})
            setLaunchDetails(Lang.queryJS('landing.systemScan.javaDownloadPrepare'))
            toggleOverlay(false)
            
            try {
                downloadJava(effectiveJavaOptions, launchAfter)
            } catch(err) {
                loggerLanding.error('Unhandled error in Java Download', err)
                showLaunchFailure(Lang.queryJS('landing.systemScan.javaDownloadFailureTitle'), Lang.queryJS('landing.systemScan.javaDownloadFailureText'))
            }
        })
        setDismissHandler(() => {
            $('#overlayContent').fadeOut(250, () => {
                //$('#overlayDismiss').toggle(false)
                setOverlayContent(
                    Lang.queryJS('landing.systemScan.javaRequired', { 'major': effectiveJavaOptions.suggestedMajor }),
                    Lang.queryJS('landing.systemScan.javaRequiredMessage', { 'major': effectiveJavaOptions.suggestedMajor }),
                    Lang.queryJS('landing.systemScan.javaRequiredDismiss'),
                    Lang.queryJS('landing.systemScan.javaRequiredCancel')
                )
                setOverlayHandler(() => {
                    toggleLaunchArea(false)
                    toggleOverlay(false)
                })
                setDismissHandler(() => {
                    toggleOverlay(false, true)

                    asyncSystemScan(effectiveJavaOptions, launchAfter)
                })
                $('#overlayContent').fadeIn(250)
            })
        })
        toggleOverlay(true, true)
    } else {
        // Java installation found, use this to launch the game.
        const javaExec = javaExecFromRoot(jvmDetails.path)
        ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), javaExec)
        ConfigManager.save()

        // We need to make sure that the updated value is on the settings UI.
        // Just incase the settings UI is already open.
        settingsJavaExecVal.value = javaExec
        await populateJavaExecDetails(settingsJavaExecVal.value)

        // TODO Callback hell, refactor
        // TODO Move this out, separate concerns.
        if(launchAfter){
            await dlAsync()
        }
    }

}

async function downloadJava(effectiveJavaOptions, launchAfter = true) {

    // TODO Error handling.
    // asset can be null.
    const asset = await latestOpenJDK(
        effectiveJavaOptions.suggestedMajor,
        ConfigManager.getDataDirectory(),
        effectiveJavaOptions.distribution)

    if(asset == null) {
        throw new Error(Lang.queryJS('landing.downloadJava.findJdkFailure'))
    }

    let received = 0
    await downloadFile(asset.url, asset.path, ({ transferred }) => {
        received = transferred
        setDownloadPercentage(Math.trunc((transferred/asset.size)*100))
    })
    setDownloadPercentage(100)

    if(received != asset.size) {
        loggerLanding.warn(`Java Download: Expected ${asset.size} bytes but received ${received}`)
        if(!await validateLocalFile(asset.path, asset.algo, asset.hash)) {
            log.error(`Hashes do not match, ${asset.id} may be corrupted.`)
            // Don't know how this could happen, but report it.
            throw new Error(Lang.queryJS('landing.downloadJava.javaDownloadCorruptedError'))
        }
    }

    // Extract
    // Show installing progress bar.
    remote.getCurrentWindow().setProgressBar(2)

    // Wait for extration to complete.
    const eLStr = Lang.queryJS('landing.downloadJava.extractingJava')
    let dotStr = ''
    setLaunchDetails(eLStr)
    const extractListener = setInterval(() => {
        if(dotStr.length >= 3){
            dotStr = ''
        } else {
            dotStr += '.'
        }
        setLaunchDetails(eLStr + dotStr)
    }, 750)

    const newJavaExec = await extractJdk(asset.path)

    // Extraction complete, remove the loading from the OS progress bar.
    remote.getCurrentWindow().setProgressBar(-1)

    // Extraction completed successfully.
    ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), newJavaExec)
    ConfigManager.save()

    clearInterval(extractListener)
    setLaunchDetails(Lang.queryJS('landing.downloadJava.javaInstalled'))

    // TODO Callback hell
    // Refactor the launch functions
    asyncSystemScan(effectiveJavaOptions, launchAfter)

}

// Keep reference to Minecraft Process
let proc
// Is DiscordRPC enabled
let hasRPC = false
// Joined server regex
// Change this if your server uses something different.
const GAME_JOINED_REGEX = /\[.+\]: Sound engine started/
const GAME_LAUNCH_REGEX = /^\[.+\]: (?:MinecraftForge .+ Initialized|ModLauncher .+ starting: .+|Loading Minecraft .+ with Fabric Loader .+)$/
// Vanilla prints no loader banner. The render backend is logged when the game window opens,
// earlier lines would bring the play button back before the window is visible.
const VANILLA_LAUNCH_REGEX = /\[.+\]: Backend library: /
const MIN_LINGER = 5000

async function dlAsync(login = true) {

    // Login parameter is temporary for debug purposes. Allows testing the validation/downloads without
    // launching the game.

    const loggerLaunchSuite = LoggerUtil.getLogger('LaunchSuite')

    setLaunchDetails(Lang.queryJS('landing.dlAsync.loadingServerInfo'))

    let distro

    try {
        distro = await DistroAPI.refreshDistributionOrFallback()
        onDistroRefresh(distro)
    } catch(err) {
        loggerLaunchSuite.error('Unable to refresh distribution index.', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.fatalError'), Lang.queryJS('landing.dlAsync.unableToLoadDistributionIndex'))
        return
    }

    const serv = distro.getServerById(ConfigManager.getSelectedServer())

    if(login) {
        if(ConfigManager.getSelectedAccount() == null){
            loggerLanding.error('You must be logged into an account.')
            return
        }
    }

    setLaunchDetails(Lang.queryJS('landing.dlAsync.pleaseWait'))
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)

    const fullRepairModule = new FullRepair(
        ConfigManager.getCommonDirectory(),
        ConfigManager.getInstanceDirectory(),
        ConfigManager.getLauncherDirectory(),
        ConfigManager.getSelectedServer(),
        DistroAPI.isDevMode()
    )

    fullRepairModule.spawnReceiver()

    fullRepairModule.childProcess.on('error', (err) => {
        loggerLaunchSuite.error('Error during launch', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), err.message || Lang.queryJS('landing.dlAsync.errorDuringLaunchText'))
    })
    fullRepairModule.childProcess.on('close', (code, _signal) => {
        if(code !== 0){
            loggerLaunchSuite.error(`Full Repair Module exited with code ${code}, assuming error.`)
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
        }
    })

    loggerLaunchSuite.info('Validating files.')
    setLaunchDetails(Lang.queryJS('landing.dlAsync.validatingFileIntegrity'))
    let invalidFileCount = 0
    try {
        invalidFileCount = await fullRepairModule.verifyFiles(percent => {
            setLaunchPercentage(percent)
        })
        setLaunchPercentage(100)
    } catch (err) {
        loggerLaunchSuite.error('Error during file validation.')
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileVerificationTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
        return
    }
    

    if(invalidFileCount > 0) {
        loggerLaunchSuite.info('Downloading files.')
        setLaunchDetails(Lang.queryJS('landing.dlAsync.downloadingFiles'))
        setLaunchPercentage(0)
        try {
            await fullRepairModule.download(percent => {
                setDownloadPercentage(percent)
            })
            setDownloadPercentage(100)
        } catch(err) {
            loggerLaunchSuite.error('Error during file download.')
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileDownloadTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
            return
        }
    } else {
        loggerLaunchSuite.info('No invalid files, skipping download.')
    }

    // Remove download bar.
    remote.getCurrentWindow().setProgressBar(-1)

    fullRepairModule.destroyReceiver()

    setLaunchDetails(Lang.queryJS('landing.dlAsync.preparingToLaunch'))

    const mojangIndexProcessor = new MojangIndexProcessor(
        ConfigManager.getCommonDirectory(),
        serv.rawServer.minecraftVersion)
    const distributionIndexProcessor = new DistributionIndexProcessor(
        ConfigManager.getCommonDirectory(),
        distro,
        serv.rawServer.id
    )

    const modLoaderData = await distributionIndexProcessor.loadModLoaderVersionJson(serv)
    const versionData = await mojangIndexProcessor.getVersionJson()

    if(login) {
        const authUser = ConfigManager.getSelectedAccount()
        loggerLaunchSuite.info(`Sending selected account (${authUser.displayName}) to ProcessBuilder.`)
        let pb = new ProcessBuilder(serv, versionData, modLoaderData, authUser, remote.app.getVersion())
        setLaunchDetails(Lang.queryJS('landing.dlAsync.launchingGame'))

        // const SERVER_JOINED_REGEX = /\[.+\]: \[CHAT\] [a-zA-Z0-9_]{1,16} joined the game/
        const SERVER_JOINED_REGEX = new RegExp(`\\[.+\\]: \\[CHAT\\] ${authUser.displayName} joined the game`)

        let loadComplete = false
        const onLoadComplete = () => {
            loadComplete = true
            toggleLaunchArea(false)
            if(hasRPC){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.loading'))
                proc.stdout.on('data', gameStateChange)
            }
            proc.stdout.removeListener('data', tempListener)
            proc.stderr.removeListener('data', gameErrorListener)
        }
        const start = Date.now()

        // Attach a temporary listener to the client output.
        // Will wait for a certain bit of text meaning that
        // the client application has started, and we can hide
        // the progress bar stuff.
        const launchRegex = modLoaderData == null ? VANILLA_LAUNCH_REGEX : GAME_LAUNCH_REGEX
        const tempListener = function(data){
            if(launchRegex.test(data.trim())){
                const diff = Date.now()-start
                if(diff < MIN_LINGER) {
                    setTimeout(onLoadComplete, MIN_LINGER-diff)
                } else {
                    onLoadComplete()
                }
            }
        }

        // Listener for Discord RPC.
        const gameStateChange = function(data){
            data = data.trim()
            if(SERVER_JOINED_REGEX.test(data)){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.joined'))
            } else if(GAME_JOINED_REGEX.test(data)){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.joining'))
            }
        }

        const gameErrorListener = function(data){
            data = data.trim()
            if(data.indexOf('Could not find or load main class net.minecraft.launchwrapper.Launch') > -1){
                loggerLaunchSuite.error('Game launch failed, LaunchWrapper was not downloaded properly.')
                showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.launchWrapperNotDownloaded'))
            }
        }

        try {
            // Build Minecraft process.
            proc = pb.build()

            // Bind listeners to stdout.
            proc.stdout.on('data', tempListener)
            proc.stderr.on('data', gameErrorListener)

            // The game exited before its window opened (e.g. a crash), give the play button back.
            proc.on('close', () => {
                if(!loadComplete){
                    toggleLaunchArea(false)
                }
            })

            setLaunchDetails(Lang.queryJS('landing.dlAsync.doneEnjoyServer'))

            // Init Discord Hook
            if(distro.rawDistribution.discord != null && serv.rawServer.discord != null){
                DiscordWrapper.initRPC(distro.rawDistribution.discord, serv.rawServer.discord)
                hasRPC = true
                proc.on('close', (code, signal) => {
                    loggerLaunchSuite.info('Shutting down Discord Rich Presence..')
                    DiscordWrapper.shutdownRPC()
                    hasRPC = false
                    proc = null
                })
            }

        } catch(err) {

            loggerLaunchSuite.error('Error during launch', err)
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.checkConsoleForDetails'))

        }
    }

}

/**
 * News
 *
 * Articles come from news.json in the GitHub repository (see newsfeed.js) and are
 * shown as cards next to a reading pane. The panel slides up over the landing view.
 */

const NewsFeed = require('./assets/js/newsfeed')

// DOM Cache
const newsList          = document.getElementById('newsList')
const newsReader        = document.getElementById('newsReader')
const newsReaderTag     = document.getElementById('newsReaderTag')
const newsReaderTitle   = document.getElementById('newsReaderTitle')
const newsReaderMeta    = document.getElementById('newsReaderMeta')
const newsReaderContent = document.getElementById('newsReaderContent')
const newsReaderLink    = document.getElementById('newsReaderLink')
const newsState         = document.getElementById('newsState')
const newsStateText     = document.getElementById('newsStateText')
const newsTeaser        = document.getElementById('newsTeaser')

// News slide caches.
let newsActive = false
let newsGlideCount = 0

// Loaded articles and the one shown in the reader.
let newsArticles = []
let newsSelected = 0
let newsAlertShown = false

/**
 * Show the news UI via a slide animation.
 *
 * @param {boolean} up True to slide up, otherwise false.
 */
function slide_(up){
    const lCUpper = document.querySelector('#landingContainer > #upper')
    const lCLLeft = document.querySelector('#landingContainer > #lower > #left')
    const lCLCenter = document.querySelector('#landingContainer > #lower > #center')
    const lCLRight = document.querySelector('#landingContainer > #lower > #right')
    const newsBtn = document.querySelector('#landingContainer > #lower > #center #content')
    const landingContainer = document.getElementById('landingContainer')
    const newsContainer = document.querySelector('#landingContainer > #newsContainer')

    newsGlideCount++

    if(up){
        lCUpper.style.top = '-200vh'
        lCLLeft.style.top = '-200vh'
        lCLCenter.style.top = '-200vh'
        lCLRight.style.top = '-200vh'
        newsBtn.style.top = '130vh'
        newsContainer.style.top = '0px'
        landingContainer.style.background = 'rgba(5, 6, 9, 0.6)'
        setTimeout(() => {
            if(newsGlideCount === 1){
                lCLCenter.style.transition = 'none'
                newsBtn.style.transition = 'none'
            }
            newsGlideCount--
        }, 2000)
    } else {
        setTimeout(() => {
            newsGlideCount--
        }, 2000)
        landingContainer.style.background = null
        lCLCenter.style.transition = null
        newsBtn.style.transition = null
        newsContainer.style.top = '100%'
        lCUpper.style.top = '0px'
        lCLLeft.style.top = '0px'
        lCLCenter.style.top = '0px'
        lCLRight.style.top = '0px'
        newsBtn.style.top = '10px'
    }
}

// Bind news button.
document.getElementById('newsButton').onclick = () => {
    // Toggle tabbing.
    if(newsActive){
        $('#landingContainer *').removeAttr('tabindex')
        $('#newsContainer *').attr('tabindex', '-1')
    } else {
        $('#landingContainer *').attr('tabindex', '-1')
        $('#newsContainer, #newsContainer *, #lower, #lower #center *').removeAttr('tabindex')
        if(newsAlertShown){
            $('#newsButtonAlert').fadeOut(2000)
            newsAlertShown = false
            ConfigManager.setNewsCacheDismissed(true)
            ConfigManager.save()
        }
    }
    slide_(!newsActive)
    newsActive = !newsActive
}

// Bind retry button.
document.getElementById('newsErrorRetry').onclick = () => {
    initNews()
}

/**
 * Format a news date for display.
 *
 * @param {Date} date
 * @returns {string}
 */
function formatNewsDate(date){
    if(date == null || Number.isNaN(date.getTime())){
        return ''
    }
    return date.toLocaleDateString(Lang.queryJS('locale.intl'), {month: 'long', day: 'numeric', year: 'numeric'})
}

/**
 * Show a message instead of the news (loading, failed, empty), or hide it.
 *
 * @param {string | null} text The message, or null to show the news.
 * @param {boolean} retry Whether to offer a retry button.
 */
function setNewsState(text, retry = false){
    if(text == null){
        newsState.style.display = 'none'
        newsList.style.display = null
        newsReader.style.display = null
        return
    }
    newsStateText.innerHTML = text
    document.getElementById('newsErrorRetry').style.display = retry ? null : 'none'
    newsState.style.display = 'flex'
    newsList.style.display = 'none'
    newsReader.style.display = 'none'
}

/**
 * Show an article in the reading pane.
 *
 * @param {number} index The article index.
 */
function displayArticle(index){
    const article = newsArticles[index]
    if(article == null){
        return
    }
    newsSelected = index
    Array.from(newsList.children).forEach((card, i) => card.toggleAttribute('selected', i === index))

    newsReaderTag.textContent = article.tag
    newsReaderTag.setAttribute('tag', article.tag.toLowerCase())
    newsReaderTitle.textContent = article.title
    newsReaderMeta.textContent = [formatNewsDate(article.date), Lang.queryJS('landing.news.author', { author: article.author })].filter(Boolean).join('  ·  ')
    newsReaderContent.innerHTML = article.html
    if(article.link){
        newsReaderLink.href = article.link
        newsReaderLink.style.display = null
    } else {
        newsReaderLink.style.display = 'none'
    }
    document.getElementById('newsReaderScroll').scrollTop = 0
}

/**
 * Build the list of news cards.
 */
function renderNewsList(){
    newsList.innerHTML = ''
    newsArticles.forEach((article, index) => {
        const card = document.createElement('button')
        card.className = 'newsCard'

        const meta = document.createElement('div')
        meta.className = 'newsCardMeta'
        const tag = document.createElement('span')
        tag.className = 'newsTag'
        tag.setAttribute('tag', article.tag.toLowerCase())
        tag.textContent = article.tag
        const date = document.createElement('span')
        date.className = 'newsCardDate'
        date.textContent = formatNewsDate(article.date)
        meta.append(tag, date)

        const title = document.createElement('span')
        title.className = 'newsCardTitle'
        title.textContent = article.title

        const summary = document.createElement('span')
        summary.className = 'newsCardSummary'
        summary.textContent = article.summary

        card.append(meta, title, summary)
        card.onclick = () => displayArticle(index)
        newsList.appendChild(card)
    })
}

/**
 * Show the alert dot on the news button if the newest article hasn't been seen yet.
 */
async function updateNewsAlert(){
    const latest = newsArticles[0]
    const hash = await digestMessage(latest.id + latest.title)
    const cached = ConfigManager.getNewsCache()
    if(cached.content !== hash || !cached.dismissed){
        if(cached.content !== hash){
            ConfigManager.setNewsCache({
                date: latest.date?.getTime() ?? null,
                content: hash,
                dismissed: false
            })
            ConfigManager.save()
        }
        newsAlertShown = true
        $('#newsButtonAlert').fadeIn(250)
    }
}

async function digestMessage(str) {
    const msgUint8 = new TextEncoder().encode(str)
    const hashBuffer = await crypto.subtle.digest('SHA-1', msgUint8)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    return hashHex
}

/**
 * Initialize News UI. This will load the news and prepare
 * the UI accordingly.
 *
 * @returns {Promise.<void>} A promise which resolves when the news
 * content has finished loading.
 */
async function initNews(){
    setNewsState(Lang.queryJS('landing.news.checking'))
    newsArticles = await NewsFeed.load()

    if(newsArticles.length === 0){
        newsTeaser.textContent = ''
        setNewsState(Lang.queryEJS('landing.newsErrorNoneSpan'), true)
        return
    }

    renderNewsList()
    displayArticle(Math.min(newsSelected, newsArticles.length - 1))
    setNewsState(null)
    newsTeaser.textContent = newsArticles[0].title
    await updateNewsAlert()
}

/**
 * Add keyboard controls to the news UI. Up and down switch
 * between articles. If you are on the landing page, the up arrow will
 * open the news UI.
 */
document.addEventListener('keydown', (e) => {
    if(newsActive){
        if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
            if(document.activeElement?.closest('#newsReader')){
                return
            }
            e.preventDefault()
            const next = e.key === 'ArrowDown' ? newsSelected + 1 : newsSelected - 1
            if(next >= 0 && next < newsArticles.length){
                displayArticle(next)
                newsList.children[next]?.scrollIntoView({ block: 'nearest' })
            }
        } else if(e.key === 'Escape'){
            document.getElementById('newsButton').click()
        }
    } else {
        if(getCurrentView() === VIEWS.landing){
            if(e.key === 'ArrowUp'){
                document.getElementById('newsButton').click()
            }
        }
    }
})
