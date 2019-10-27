'use strict'
const fs = require('fs')
const path = require('path')

const u = require('@elife/utils')

const jughead = require('jughead')
const archieml = require('archieml')


module.exports = {
    loadExistingKBs: loadExistingKBs,
    saveKBTpl: saveKBTpl,
    saveAns: saveAns,
    getKBs: getKBs,
    getAs: getAs,
    getQs: getQs,
    clean: clean,
    xportKB: xportKB,
    reloadKB: reloadKB,
    convertPunctuationToString: convertPunctuationToString,
    convertStringToPunctuation: convertStringToPunctuation,
}

/*      understand/
 * While we have a KB template (global variable `Qs`)
 * and a set of slot answers (global variable `As`)
 * we need a place where everything is held together
 * in each KB structure. These are the KBs.
 */
let KBs
function getKBs() {
    return KBs
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
    As = as
    fill_kb_1(as)

    ssbClient.send({
        type: 'new-pvt-log',
        msg: {
            type: 'kb-data',
            data: as,
        },
    }, cb)

    /*      outcome/
     * Find slot that matches answers and fill them
     */
    function fill_kb_1(as) {
        for(let a in as) {
            for(let k in KBs) {
                let kb = KBs[k]
                for(let i = 0;i < kb.data.length;i++) {
                    if(kb.data[i].Name == a) {
                        kb.data[i].Answer = as[a]
                    }
                }
            }
        }
    }
}

/*      outcome/
 * Get the KB Templates both from disk and from the Everchain, and
 * convert them into more readable (archieml) format. Also create the
 * question slots and fill them in with any answer KB data stored in the
 * Everchain.
 */
function loadExistingKBs(ssbClient,avatarid, cb) {
    KBs = {}
    Qs = {}
    As = {}

    load_from_disk_1((err, kbsDisk) =>{
        if(err) cb(err)
        else load_from_ssb_1(ssbClient,avatarid, (err, kbsChain) => {
            if(err) cb(err)
            else {
                let kbs = merge_1(kbsDisk, kbsChain)
                add_to_archie_kbs_1(kbs, KBs)
                create_kb_slots_1(kbs, Qs, As)
                fill_kb_slots_1(ssbClient, KBs, As, cb)
            }
        })
    })

    /*      outcome/
     * Merge the two KB's by starting with all the values of KB1 and
     * overwriting/adding values from KB2
     */
    function merge_1(KB1, KB2) {
        let kbs = KB1
        for(let k in KB2) {
            kbs[k] = KB2[k]
        }
        return kbs
    }

    /*      outcome/
     * Read the KB files as JSON from disk - they are kept next to their
     * corresponding AIML files
     */
    function load_from_disk_1(cb) {
        let defaultKBsPath = path.join(__dirname, 'aiml/aiml/botdata/elife/')
        fs.readdir(defaultKBsPath, (err, files) => {
            if(err) cb(err)
            else load_json_from_1(files, 0, {})
        })

        function load_json_from_1(files, ndx, kbs) {
            if(ndx >= files.length) return cb(null, kbs)
            let f = files[ndx]
            if(f.endsWith('.json')) {
                fs.readFile(path.join(defaultKBsPath, f), (err, data) => {
                    if(err) cb(err)
                    else {
                        try {
                            let kb = JSON.parse(data)
                            if(kb && kb.name) kbs[kb.name] = kb
                            load_json_from_1(files, ndx+1, kbs)
                        } catch(e) {
                            cb(e)
                        }
                    }
                })
            } else load_json_from_1(files, ndx+1, kbs)
        }
    }

    /*      outcome/
     * Walk the kb template messages and return them as existing KB's.
     */
    function load_from_ssb_1(ssbClient,avatarid, cb) {
        ssbClient.send({
            type: 'msg-by-type',
            msgtype: 'kb-template',
        }, (err, msgs) => {
            if(err) cb(err)
            else {
                let kbs = {}
                for(let msg of msgs) {
                    if(msg.value.author === avatarid){
                        let kb = msg.value.content.kb
                        if(kb && kb.name) kbs[kb.name] = kb
                    }
                }
                cb(null, kbs)
            }
        })
    }

    /*      outcome/
     * Add the given KB's into our global KB store (in a more readable
     * archie format)
     */
    function add_to_archie_kbs_1(kbs, dest) {
        for(let k in kbs) {
            let kb = kbs[k]
            dest[kb.name] = archieKB(kb)
        }
    }

    /*      outcome/
     * Save the slots in the KB templates
     */
    function create_kb_slots_1(kbs, Qdest, Adest) {
        for(let k in kbs) {
            let kb = kbs[k]
            for(let s of kb.data) {
                // TODO: Check for duplicate slots
                Qdest[s.slot] = s
                Adest[s.slot] = undefined
            }
        }
    }

    /*      outcome/
     * Find the latest `kb-data` and populate the KB data with it.
     */
    function fill_kb_slots_1(ssbClient, KBs, As, cb) {
        ssbClient.send({
            type: 'msg-by-type',
            msgtype: 'kb-data',
        }, (err, msgs) => {
            if(err) cb(err)
            else {
                let latest
                for(let msg of msgs) latest = msg
                get_answers_1(latest, As)
                fill_kb_1(latest, KBs)
                cb()
            }
        })
    }

    function get_answers_1(ans, As) {
        if(!ans) return
        let slots = ans.value.content.data
        for(let slot in slots) {
            As[slot] = slots[slot]
        }
    }
    /*      outcome/
     * Find slot that matches our answer and fill it
     */
    function fill_kb_1(ans, KBs) {
        if(!ans) return
        let slots = ans.value.content.data
        for(let slot in slots) {
            for(let k in KBs) {
                let kb = KBs[k]
                for(let i = 0;i < kb.data.length;i++) {
                    if(kb.data[i].Name == slot) {
                        kb.data[i].Answer = slots[slot]
                    }
                }
            }
        }
    }
}

/*      outcome/
 * Convert the kb on the chain to a nicely formatted ArchieML-type
 * object:
 *     { name: 'music',
 *       startPhrase: 'Ask about music',
 *       data:
 *        [ { slot: 'bestsong',
 *            q: 'What is your favorite song?',
 *            resp: 'I like "Dancing Queen" by Abba - shake your booty'
 *          },
 *          { slot: 'favartist',
 *            q: 'Who is your favorite artist?',
 *            resp: 'I like electronic music'
 *          }
 *        ]
 *    }
 *          to
 *     {
 *       EntryStatement: 'Ask about music',
 *       data:
 *        [ { Name: 'bestsong',
 *            Question: 'What is your favorite song?',
 *            AvatarSays: 'I like "Dancing Queen" by Abba - shake your booty'
 *          },
 *          { Name: 'favartist',
 *            Question: 'Who is your favorite artist?',
 *            AvatarSays: 'I like electronic music'
 *          }
 *        ]
 *    }
 */
function archieKB(kb) {
    let KB = {
        EntryStatement: kb.startPhrase,
        data: []
    }
    for(let i = 0;i < kb.data.length;i++) {
        KB.data.push(conv_1(kb.data[i]))
    }
    return KB

    function conv_1(q) {
        return {
            Name: q.slot,
            Question: q.q,
            AvatarSays: q.resp,
        }
    }
}

/*      outcome/
 * Convert the given archie to a template
 */
function archie2Tpl(name, kb) {
    return {
        name: name,
        startPhrase: kb.EntryStatement,
        data: tpl_data_1(kb.data)
    }

    function tpl_data_1(data) {
        let r = []
        for(let i = 0;i < data.length;i++) {
            let c = data[i]
            r.push({
                slot: c.Name,
                q: c.Question,
                resp: c.AvatarSays,
            })
        }
        return r
    }
}

/*          outcome/
 * Extract the slot answers from the KB and make it into a kb-data
 * format
 */
function archie2As(kbs) {
    let r = {}
    for(let k in kbs) {
        let kb = kbs[k]
        for(let i = 0;i < kb.data.length;i++) {
            let c = kb.data[i]
            r[c.Name] = c.Answer
        }
    }
    return r
}

/*      outcome/
 * Save the Knowledge Base into the location as a JSON file and a
 * corresponding AIML file and persist it into the Everchain.
 */
function saveKBTpl(loc, ssbClient, kb, cb) {
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

function xportKB(loc, cb) {
    let kbs = getKBs()

    xport_kb_ndx_1(0, Object.keys(kbs), kbs)

    function xport_kb_ndx_1(ndx, keys, kbs) {
        if(ndx >= keys.length) return cb()
        let k = keys[ndx]
        let pfx = `This is your Knowledge Base entry for "${k}".
You can add, remove, and edit your KB questions and answers
here and then ask your avatar to load the changes using the
'/reload_kb' command.

`

        let p = path.join(loc, `${k}.txt`)

        fs.writeFile(p, pfx, (err) => {
            if(err) cb(err)
            else {
                let txt = jughead.archieml(kbs[k])
                fs.appendFile(p, txt, (err) => {
                    if(err) cb(err)
                    else xport_kb_ndx_1(ndx+1, keys, kbs)
                })
            }
        })

    }
}

/*      outcome/
 * Walk the KB location and load all text files (that are actually
 * ArchieML files with KB data). Load them into a KB and split them into
 * Q's and A's - saving the updated ones.
 */
function reloadKB(loc, ssbClient, cb) {
    fs.readdir(loc, 'utf8', (err, files) => {
        if(err) cb(err)
        else {
            let archies = files.filter(f => f.endsWith('.txt'))
            load_archie_ndx_1(0, archies, {}, (err, kbs) => {
                if(err) cb(err)
                else {
                    save_updated_tpls_1(kbs, (err) => {
                        if(err) cb(err)
                        else save_updated_slots_1(kbs, cb)
                    })
                }
            })
        }
    })

    function save_updated_slots_1(kbs, cb) {
        let as = archie2As(kbs)
        let orig = archie2As(KBs)
        if(as.length != orig.length) return saveAns(ssbClient, as, cb)
        for(let k in as) {
            if(as[k] != orig[k]) return saveAns(ssbClient, as, cb)
        }
        cb()
    }

    function load_archie_ndx_1(ndx, archies, kbs, cb) {
        if(ndx >= archies.length) return cb(null, kbs)
        let archie = path.join(loc, archies[ndx])
        let name = path.basename(archies[ndx], '.txt')
        fs.readFile(archie, 'utf8', (err, data) => {
            if(err) cb(err)
            else {
                kbs[name] = archieml.load(data)
                load_archie_ndx_1(ndx+1, archies, kbs, cb)
            }
        })
    }

    function save_updated_tpls_1(kbs, cb) {
        let keys = Object.keys(kbs)
        save_if_updated_ndx_1(0, keys)

        function save_if_updated_ndx_1(ndx, keys) {
            if(ndx >= keys.length) return cb()
            let name = keys[ndx]
            let kb = kbs[name]
            let orig = KBs[name]
            if(is_tpl_diff_1(kb, orig)) {
                saveKBTpl(loc, ssbClient, archie2Tpl(name, kb), (err) => {
                    if(err) cb(err)
                    else save_if_updated_ndx_1(ndx+1, keys)
                })
            } else {
                save_if_updated_ndx_1(ndx+1, keys)
            }
        }
    }

    function is_tpl_diff_1(kb1, kb2) {
        if(kb1.EntryStatement != kb2.EntryStatement) return true
        if(kb1.data.length != kb2.data.length) return true
        for(let i = 0;i < kb1.data.length;i++) {
            if(kb1.data[i].Name != kb2.data.Name) return true
            if(kb1.data[i].Question != kb2.data.Question) return true
            if(kb1.data[i].AvatarSays != kb2.data.AvatarSays) return true
        }
        return false
    }
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
