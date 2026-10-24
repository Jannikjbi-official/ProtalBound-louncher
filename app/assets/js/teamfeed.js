/**
 * Team page data from team.json in the GitHub repository, so the team can be
 * updated without shipping a launcher update. The copy bundled with the
 * launcher is used when GitHub can't be reached.
 */
const fs             = require('fs-extra')
const got            = require('got')
const path           = require('path')
const remote         = require('@electron/remote')
const { LoggerUtil } = require('helios-core')

const logger = LoggerUtil.getLogger('TeamFeed')

exports.REMOTE_TEAM_URL = 'https://raw.githubusercontent.com/Jannikjbi-official/ProtalBound-louncher/main/team.json'

const HEX = /^#[0-9a-fA-F]{6}$/
const MC_NAME = /^[A-Za-z0-9_]{1,16}$/

function normalize(member){
    const colors = Array.isArray(member.colors) ? member.colors.filter(c => HEX.test(c)) : []
    return {
        name: String(member.name ?? ''),
        role: String(member.role ?? ''),
        description: String(member.description ?? ''),
        colors: colors.length >= 2 ? colors.slice(0, 2) : ['#9A78FF', '#56D9E7'],
        links: (Array.isArray(member.links) ? member.links : [])
            .filter(l => typeof l?.url === 'string' && /^https:\/\//.test(l.url))
            .map(l => ({ label: String(l.label ?? l.url), url: l.url }))
    }
}

/**
 * @returns {Promise<Array<Object>>} Team members in the order of team.json.
 */
exports.load = async function(){
    let data = null
    try {
        const res = await got.get(exports.REMOTE_TEAM_URL, { responseType: 'json', timeout: 5000, retry: 0 })
        data = res.body
    } catch(err) {
        logger.warn('Unable to load the team from GitHub, using the bundled copy.')
        logger.debug(err)
    }
    if(data?.members == null){
        try {
            data = await fs.readJson(path.join(remote.app.getAppPath(), 'team.json'))
        } catch(err) {
            logger.error('Unable to read the bundled team.', err)
            return []
        }
    }
    return (data.members || []).map(normalize).filter(m => MC_NAME.test(m.name))
}
