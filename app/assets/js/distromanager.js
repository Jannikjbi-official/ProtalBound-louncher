const fs = require('fs-extra')
const path = require('path')
const { LoggerUtil } = require('helios-core')
const { DistributionAPI, RestResponseStatus } = require('helios-core/common')

const ConfigManager = require('./configmanager')

const logger = LoggerUtil.getLogger('DistroManager')

// Server information is loaded from the GitHub repository, so the server list can be
// changed without shipping a new launcher. If GitHub can't be reached, the copy
// bundled with the launcher (app/assets/distribution.json) is used.
exports.REMOTE_DISTRO_URL = 'https://raw.githubusercontent.com/Jannikjbi-official/ProtalBound-louncher/main/app/assets/distribution.json'

exports.BUNDLED_DISTRO_PATH = path.join(__dirname, '..', 'distribution.json')

class PortalboundDistributionAPI extends DistributionAPI {

    async pullRemote() {
        const res = await super.pullRemote()
        if(res.data != null) {
            return res
        }
        logger.info('Remote distribution index unavailable, using the bundled copy.')
        try {
            return {
                data: await fs.readJson(exports.BUNDLED_DISTRO_PATH),
                responseStatus: RestResponseStatus.SUCCESS
            }
        } catch(err) {
            logger.error('Unable to read the bundled distribution index.', err)
            return res
        }
    }

}

const api = new PortalboundDistributionAPI(
    ConfigManager.getLauncherDirectory(),
    null, // Injected forcefully by the preloader.
    null, // Injected forcefully by the preloader.
    exports.REMOTE_DISTRO_URL,
    false
)

exports.DistroAPI = api
