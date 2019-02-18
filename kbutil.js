'use strict'
const fs = require('fs')
const path = require('path')

const u = require('elife-utils')


module.exports = {
    saveKB: saveKB,
}


/*      outcome/
 * Save the Knowledge Base into the location as a JSON file and a
 * corresponding AIML file and persist it into the Everchain.
 */
function saveKB(loc, ssbClient, kb, cb) {
    u.ensureExists(loc, (err) => {
        if(err) cb(err)
        else {
            saveJSON(loc, kb, (err) => {
                if(err) cb(err)
                else saveAIML(loc, kb, (err, aimlf) => {
                    if(err) cb(err)
                    else saveTemplateInEverchain(aimlf, kb, ssbClient, cb)
                })
            })
        }
    })
}

/*      outcome/
 * Save the AIML file as a blob, then save it's reference as a 'mention'
 * in the KB template which we save to the everchain.
 */
function saveTemplateInEverchain(aimlf, kb, ssbClient, cb) {
    ssbClient.send({
        type: 'blob-save-file',
        filePath: aimlf
    }, (err, hash) => {
        if(err) cb(err)
        else {
            let mention = {
                link: hash,
                name: path.basename(aimlf),
                type: 'text/xml',
            }
            let msg = {
                type: 'kb-template',
                kb: kb,
                mentions: [ mention ],
            }
            fs.lstat(aimlf, (err, stats) => {
                if(!err) mention.size = stats.size
                ssbClient.send({
                    type: 'new-msg',
                    msg: msg
                }, cb)
            })
        }
    })
}

/*      outcome/
 * Save the KB as a nicely formatted JSON.
 */
function saveJSON(loc, kb, cb) {
    let d = JSON.stringify(kb, null, 2)

    let name = kb.name
    if(!name) cb(`Error: KB missing name! ${d}`)
    else {
        let p = path.join(loc, `${name}.json`)
        fs.writeFile(p, d, (err) => {
            if(err) cb(err)
            else cb(null, p)
        })
    }
}

/*      outcome/
 * Save the KB as a AIML file.
 */
function saveAIML(loc, kb, cb) {
    let d = toAIML(kb)

    let name = kb.name
    if(!name) cb(`Error: KB missing name!`)
    else {
        let p = path.join(loc, `${name}.aiml`)
        fs.writeFile(p, d, (err) => {
            if(err) cb(err)
            else cb(null, p)
        })
    }
}

/*      outcome/
 * Convert the KB into AIML
 *      - the header
 *      - the entry/start phrase
 *      - the questions section
 *      - the getting variables section
 *      - the setting variables section
 *      - the footer
 */
function toAIML(kb) {
    let d = header_1(kb)
    d += entry_1(kb)
    d += questions_1(kb)
    d += getvars_1(kb)
    d += setvars_1(kb)
    d += footer_1(kb)
    return d

    function header_1(kb) {
        return `<?xml version="1.0" encoding="UTF-8"?>
<aiml version="1.0">

`
    }

    function entry_1(kb) {
        let q = askqsrai(kb)
        let startPhrase = clean(kb.startPhrase)
        return `<category>
<pattern>${startPhrase}</pattern>
<template><srai>${q}</srai></template>
</category>


`
    }

    function questions_1(kb) {
        let q = askqsrai(kb)

        let lis = ""
        for(let i = 0;i < kb.data.length;i++) {
            let s = kb.data[i]
            let slot = clean(s.slot.toLowerCase())
            lis += `<li name="${slot}" value="">${s.q}</li>
`
        }

        return `<category>
<pattern>${q}</pattern>
<template>
<condition>
${lis}
</condition>
</template>
</category>


`
    }

    function getvars_1(kb) {
        let v = ""
        for(let i = 0;i < kb.data.length;i++) {
            let s = kb.data[i]
            let slot = clean(s.slot.toLowerCase())
            let q = clean(s.q.toUpperCase())
            v += `<category>
<pattern>${q}</pattern>
<template>
<condition>
<li name="${slot}" value="">I don't know yet</li>
<li><get name="${slot}"/></li>
</condition>
</template>
</category>

`
        }
        v += '\n'
        return v
    }

    function setvars_1(kb) {
        let v = ""
        let q1 = askqsrai(kb)
        for(let i = 0;i < kb.data.length;i++) {
            let s = kb.data[i]
            let r = get_resp_1(s)
            let q2 = clean(s.q.toUpperCase())
            v += `<category>
<pattern>*</pattern>
<that>* ${q2}</that>
<template>
    ${r}
    <srai>${q1}</srai>
</template>
</category>

`
        }
        v += '\n'
        return v
    }

    function get_resp_1(s) {
        let n = s.resp.indexOf('$$')
        let slot = clean(s.slot.toLowerCase())
        if(n == -1) {
            return `<think><set name="${slot}"><star/></set></think>
    ${s.resp}`
        }
        let p = s.resp.substring(0, n)
        let f = s.resp.substring(n+2)
        return `${p}<set name="${slot}"><star/></set>${f}`
    }

    function footer_1(kb) {
        return `</aiml>`
    }

}

function askqsrai(kb) {
    return `ASK${kb.name}QS`
}

function clean(txt) {
    return txt.replace(/[.,\/#!?$%\^&\*;:{}=\-_~()]/g, '')
}
