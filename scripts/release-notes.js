// Prints the CHANGELOG.md section of the version in package.json, used as GitHub release notes.
// Usage: node scripts/release-notes.js [version]
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const version = process.argv[2] || require(path.join(root, 'package.json')).version
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf-8')

const sections = changelog.split(/^## /m).slice(1)
const section = sections.find(s => s.startsWith(`[${version}]`))
if(section == null){
    console.error(`No CHANGELOG.md section for ${version}.`)
    process.exit(1)
}

const [heading, ...body] = section.split('\n')
const title = heading.replace(/^\[[^\]]+\]\s*-\s*[\d-]+\s*(?:-\s*)?/, '').trim()
console.log((title ? `**${title}**\n` : '') + body.join('\n').trim())
