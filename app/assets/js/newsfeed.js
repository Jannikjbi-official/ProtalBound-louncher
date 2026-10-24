/**
 * Launcher news from news.json in the GitHub repository, so the team can post
 * news without shipping a launcher update. The copy bundled with the launcher
 * is used when GitHub can't be reached.
 */
const fs             = require('fs-extra')
const got            = require('got')
const path           = require('path')
const remote         = require('@electron/remote')
const { LoggerUtil } = require('helios-core')
const Markdown       = require('./markdown')

const logger = LoggerUtil.getLogger('NewsFeed')

exports.REMOTE_NEWS_URL = 'https://raw.githubusercontent.com/Jannikjbi-official/ProtalBound-louncher/main/news.json'

function normalize(article, index){
    return {
        id: String(article.id ?? index),
        title: String(article.title ?? ''),
        date: article.date ? new Date(article.date) : null,
        tag: String(article.tag ?? 'News'),
        author: String(article.author ?? 'Portalbound'),
        summary: String(article.summary ?? ''),
        html: Markdown.render(Array.isArray(article.content) ? article.content.join('\n') : String(article.content ?? '')),
        link: typeof article.link === 'string' && /^https?:\/\//.test(article.link) ? article.link : null
    }
}

/**
 * @returns {Promise<Array<Object>>} Articles, newest first.
 */
exports.load = async function(){
    let data = null
    try {
        const res = await got.get(exports.REMOTE_NEWS_URL, { responseType: 'json', timeout: 5000, retry: 0 })
        data = res.body
    } catch(err) {
        logger.warn('Unable to load news from GitHub, using the bundled copy.')
        logger.debug(err)
    }
    if(data?.articles == null){
        try {
            data = await fs.readJson(path.join(remote.app.getAppPath(), 'news.json'))
        } catch(err) {
            logger.error('Unable to read the bundled news.', err)
            return []
        }
    }
    return (data.articles || [])
        .map(normalize)
        .filter(a => a.title)
        .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
}
