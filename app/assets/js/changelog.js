/**
 * Reads CHANGELOG.md, which ships with the launcher.
 *
 * Sections look like:
 *   ## [1.0.0] - 2026-10-24 - Optional title
 *   ### New
 *   - Something
 */
const fs       = require('fs')
const path     = require('path')
const remote   = require('@electron/remote')
const Markdown = require('./markdown')

let cache = null

/**
 * @returns {Array<{version: string, date: string, title: string, html: string}>} Newest first.
 */
exports.getEntries = function(){
    if(cache != null){
        return cache
    }
    let text = ''
    try {
        text = fs.readFileSync(path.join(remote.app.getAppPath(), 'CHANGELOG.md'), 'utf-8')
    } catch(_err) {
        cache = []
        return cache
    }
    cache = text.split(/^## /m).slice(1).map(section => {
        const [heading, ...body] = section.split(/\r?\n/)
        const match = /^\[([^\]]+)\]\s*(?:-\s*([\d-]+))?\s*(?:-\s*(.*))?$/.exec(heading.trim()) || []
        return {
            version: match[1] || heading.trim(),
            date: match[2] || '',
            title: (match[3] || '').trim(),
            html: Markdown.render(body.join('\n'))
        }
    })
    return cache
}

/**
 * @param {string} version
 * @returns {{version: string, date: string, title: string, html: string} | null}
 */
exports.getEntry = function(version){
    return exports.getEntries().find(e => e.version === version) || null
}
