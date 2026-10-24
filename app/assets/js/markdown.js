/**
 * Minimal Markdown renderer for the changelog and news.
 *
 * Supports headings (## / ###), paragraphs, "-" lists, **bold**, *italic*,
 * `code` and [links](https://…). Everything else is escaped, so content
 * loaded from GitHub can't inject HTML into the launcher.
 */

function escapeHtml(text){
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

function inline(text){
    return escapeHtml(text)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
}

/**
 * @param {string} markdown
 * @returns {string} HTML
 */
exports.render = function(markdown){
    const html = []
    let list = false
    let paragraph = []

    const flushParagraph = () => {
        if(paragraph.length > 0){
            html.push(`<p>${inline(paragraph.join(' '))}</p>`)
            paragraph = []
        }
    }
    const closeList = () => {
        if(list){
            html.push('</ul>')
            list = false
        }
    }

    for(const raw of (markdown || '').split(/\r?\n/)){
        const line = raw.trim()
        const heading = /^(#{2,3})\s+(.*)$/.exec(line)
        const item = /^[-*]\s+(.*)$/.exec(line)
        if(line === ''){
            flushParagraph()
            closeList()
        } else if(heading){
            flushParagraph()
            closeList()
            const level = heading[1].length === 2 ? 'h3' : 'h4'
            html.push(`<${level}>${inline(heading[2])}</${level}>`)
        } else if(item){
            flushParagraph()
            if(!list){
                html.push('<ul>')
                list = true
            }
            html.push(`<li>${inline(item[1])}</li>`)
        } else {
            closeList()
            paragraph.push(line)
        }
    }
    flushParagraph()
    closeList()
    return html.join('\n')
}

exports.escapeHtml = escapeHtml
