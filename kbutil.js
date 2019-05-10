'use strict'
const fs = require('fs')
const path = require('path')

const u = require('elife-utils')


module.exports = {
    loadChainKBs: loadChainKBs,
    saveKBTpl: saveKBTpl,
    getAs: getAs,
    getQs: getQs,
    saveAns: saveAns,
    clean: clean,
    convertPunctuationToString: convertPunctuationToString,
    convertStringToPunctuation: convertStringToPunctuation,
}

/*      understand/
 * The knowledge base of answers that the user
 * has provided to the avatar.
 */
let As
function getAs() {
    return As
}

/*      understand/
 * The questions linked to the Knowlege base.
 */
let Qs
function getQs() {
    return Qs
}


/*      outcome/
 * Save the answers as a `kb-data` message
 */
function saveAns(ssbClient, as, cb) {
    ssbClient.send({
        type: 'new-pvt-log',
        msg: {
            type: 'kb-data',
            data: as,
        },
    }, cb)
}

/*      outcome/
 * Get all the KB templates and create their slots. Then fill in the
 * slots with the KB data.
 */
function loadChainKBs(ssbClient, cb) {
    As = {}
    Qs = {}
    create_kb_slots_1(ssbClient, As, (err) => {
        if(err) cb(err)
        else {
            fill_kb_slots_1(ssbClient, Qs, As, cb)
        }
    })

    /*      outcome/
     * Walk the kb-template messages get the latest messages. Then fill
     * in all the available slots from the latest templates.
     */
    function create_kb_slots_1(ssbClient, As, cb) {
        ssbClient.send({
            type: 'msg-by-type',
            msgtype: 'kb-template',
        }, (err, msgs) => {
            if(err) cb(err)
            else {
                let kbs = {}
                for(let msg of msgs) {
                    let kb = msg.value.content.kb
                    if(kb && kb.name) kbs[kb.name] = kb
                }
                for(let k in kbs) {
                    // TODO: Check for duplicate slots
                    for(let s of kbs[k].data) {
                        Qs[s.slot] = s
                        As[s.slot] = undefined
                    }
                }
                cb(null)
            }
        })
    }

    /*      outcome/
     * Find the latest `kb-data` and populate the KB data with it.
     */
    function fill_kb_slots_1(ssbClient, Qs, As, cb) {
        ssbClient.send({
            type: 'msg-by-type',
            msgtype: 'kb-data',
        }, (err, msgs) => {
            if(err) cb(err)
            else {
                let latest
                for(let msg of msgs) {
                    latest = msg
                }
                if(latest) {
                    let slots = latest.value.content.data
                    for(let slot in slots) {
                        As[slot] = slots[slot]
                    }
                }
                cb()
            }
        })
    }
}

/*      outcome/
 * Save the Knowledge Base into the location as a JSON file and a
 * corresponding AIML file and persist it into the Everchain. Then
 * reload KB's from the Everchain so we are ready with the latest KB
 * data.
 */
function saveKBTpl(loc, ssbClient, kb, cb) {
    u.ensureExists(loc, (err) => {
        if(err) cb(err)
        else {
            saveJSON(loc, kb, (err) => {
                if(err) cb(err)
                else saveAIML(loc, kb, (err, aimlf) => {
                    if(err) cb(err)
                    else saveTemplateInEverchain(aimlf, kb, ssbClient, (err) => {
                        if(err) cb(err)
                        else loadChainKBs(ssbClient, cb)
                    })
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
<template>Ok. <srai>${convertPunctuationToString(q)}</srai></template>
</category>


`
    }

    function questions_1(kb) {
        let q = askqsrai(kb)

        let lis = ""
        for(let i = 0;i < kb.data.length;i++) {
            let s = kb.data[i]
            let slot = clean(s.slot.toLowerCase())
            lis += `<li name="${slot}" value="">${convertPunctuationToString(s.q)}</li>
`
        }
        lis += `<li>I can't think of anything else to ask you :-)</li>
`

        return `<category>
<pattern>${convertPunctuationToString(q)}</pattern>
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
            let q = clean(convertPunctuationToString(s.q).toUpperCase())
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
            let q2 = clean(convertPunctuationToString(s.q).toUpperCase())
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
        return `${convertPunctuationToString(p)}<set name="${slot}"><star/></set>${f}`
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

function convertPunctuationToString(txt){
    txt = txt.replace(/\u0027/g,"elifeapostrophe")
    txt = txt.replace(/\u002A/g,"elifeasterisk")
    txt = txt.replace(/\u0022/g,'elifedoublequote')
    txt = txt.replace(/\u0040/g,"elifeatsign")
    txt = txt.replace(/\u0024/g,"elifedollar")
    txt = txt.replace(/\u0025/g,"elifepercentage")
    txt = txt.replace(/\u0026/g,"elifeampersand")
    txt = txt.replace(/\u002D/g,"elifeminus")
    txt = txt.replace(/\u002F/g,"elifedivide")
    txt = txt.replace(/\u002B/g,"elifeaddition")
    txt = txt.replace(/\u005E/g,"elifecaret")

    return txt
}
function convertStringToPunctuation(txt){
    txt = txt.replace(/elifeapostrophe/g, "'")
    txt = txt.replace(/elifeasterisk/g,"*")
    txt = txt.replace(/elifedoublequote/g,'"')
    txt = txt.replace(/elifeatsign/g,"@")
    txt = txt.replace(/elifedollar/g,"$")
    txt = txt.replace(/elifepercentage/g,"%")
    txt = txt.replace(/elifeampersand/g,"&")
    txt = txt.replace(/elifeminus/g,"-")
    txt = txt.replace(/elifedivide/g,"/")
    txt = txt.replace(/elifeaddition/g,"+")
    txt = txt.replace(/elifecaret/g,"^")

    return txt
}
