'use strict'
const cote = require('cote')({statusLogsEnabled:false})
const u = require('@elife/utils')
const pm2 = require('@elife/pm2')
const fs = require('fs')
const path = require('path')
const request = require('request')

const kbutil = require('./kbutil')


/*      understand/
 * This is the main entry point where we start
 * the AIML server, our own microservice, and
 * the knowledge base server.
 */
function main() {
    let cfg = loadConfig()
    ensureKBDirExists(cfg)
    u.showMsg(`Starting aiml-server...`)
    startAIMLServer(cfg)
    u.showMsg(`Starting microservice...`)
    startMicroservice(cfg)

    u.showMsg(`Starting Knowledge Base...`)
    startKB(cfg)

}

/**
 *      outcome/
 * Check whether KB data directory is exists or not
 * If not exists it will create a KB data directory
 */
function ensureKBDirExists(cfg){
    u.ensureExists(cfg.KBDIR, (err) => u.showErr(err))
}

/*      outcome/
 * Load the configuration (from environment variables) or defaults
 */
function loadConfig() {
    let cfg = {};

    if(process.env.EBRAIN_AIML_PORT) {
        cfg.EBRAIN_AIML_PORT = process.env.EBRAIN_AIML_PORT
    } else {
        cfg.EBRAIN_AIML_PORT = u.adjustPort(8765)
    }

    if(process.env.EBRAIN_AIML_KB_DIR) {
        cfg.KBDIR = process.env.EBRAIN_AIML_KB_DIR
    } else {
        cfg.KBDIR = path.join(u.dataLoc(), 'kb')
    }

    if(process.env.EBRAIN_AIML_STARTUP_DELAY) {
        cfg.EBRAIN_AIML_STARTUP_DELAY = process.env.EBRAIN_AIML_STARTUP_DELAY
    } else {
        cfg.EBRAIN_AIML_STARTUP_DELAY = 5*1000
    }

    if(process.env.EBRAIN_AIML_UPDATE_POLL_FREQ) {
        cfg.EBRAIN_AIML_UPDATE_POLL_FREQ = process.env.EBRAIN_AIML_UPDATE_POLL_FREQ
    } else {
        cfg.EBRAIN_AIML_UPDATE_POLL_FREQ = 3*60*1000
    }

    return cfg;
}

const SERVER_NAME = 'aiml-server'
let LOADING_CBS = []
let loadedkb = false

/*      outcome/
 * Use PM2 to start the python AIML server
 */
function startAIMLServer(cfg) {
    let cwd = kbutil.unpackedAsarPath('aiml')
    pm2.start ({
        name: SERVER_NAME,
        script: "serve.py",
        cwd: cwd,
        log: path.join(u.logsLoc(), `aiml-server.log`),
        stripANSI: true,
    })
}

/*      outcome/
 * Use PM2 to restart the python AIML server
 */
function restartAIMLServer(cfg) {
    pm2.restart(SERVER_NAME)
}

const ssbClient = new cote.Requester({
    name: 'ebrain-aiml -> SSB',
    key: 'everlife-ssb-svc',
})

/*      outcome/
 * Get the avatar id
 */

function getAvatarID(cb) {
    ssbClient.send({ type: 'avatar-id' }, cb)
}

/*      outcome/
 * Start our microservice to route calls
 * to the AIML brain for anyone who
 * doesn't want to use the HTTP service.
 */
function startMicroservice(cfg) {
    const ms = new cote.Responder({
        name: 'Everlife AIML Brain',
        key: 'ebrain-aiml',
    })

    ms.on('kb-msg', (req, cb) => {
        getKBResponse(cfg, req.msg, cb)
    })

    ms.on('user-msg', (req, cb) => {
        getAIMLResponse(cfg, kbutil.convertPunctuationToString(req.msg), cb)
    })

    ms.on('save-kb-tpl', (req, cb) => {
        kbutil.saveKBTpl(cfg.KBDIR, ssbClient, req.kb, (err) => {
            if(err) u.showErr(err)
            else {
                u.showMsg(`Saved new KB: ${req.kb.name}`)
                restartAIMLServer(cfg)
            }
        })
    })

    ms.on('xport-kb', (req, cb) => {
        kbutil.xportKB(cfg.KBDIR, cb)
    })

    /*
     *      outcome/
     * If the KB's have not yet been loaded, we keep track of the
     * callbacks so they can be invoked once the KB's have been loaded.
     */
    ms.on('kb-loaded-event', (req, cb) => {
        if(loadedkb) cb()
        else LOADING_CBS.push(cb)
    })

    ms.on('reload-kb', (req, cb) => {
        kbutil.reloadKB(cfg.KBDIR, ssbClient, (err) => {
            if(err) cb(err)
            else {
                u.showMsg(`Reloaded KB's from ArchieML`)
                restartAIMLServer(cfg)
                cb()
            }
        })
    })

}

function getKBResponse(cfg, msg, cb) {
    if(!msg) return cb()
    msg = msg.trim()
    if(!msg) return cb()
    msg = msg.toLowerCase()

    let qs = kbutil.getQs()
    if(!qs) return cb()

    for(let q in qs) {
        let s = qs[q]
        if(matching_q_1(msg, s.q)) {
            return cb(null, ans_1(s.slot))
        }
    }
    cb()


    function ans_1(slot) {
        let as = kbutil.getAs()
        let a = a[slot]
        if(a) return a
        return '(NO ANSWER)'
    }

    function matching_q_1(q1, q2) {
        if(!q1 || !q2) return false
        q1 = q1.toLowerCase()
        q2 = q2.toLowerCase()
        q1 = kbutil.clean(q1)
        q2 = kbutil.clean(q2)
        return q1 == q2
    }
}

/*      outcome/
 * Make a HTTP call to our AIML brain
 * to get a response to the message
 */
function getAIMLResponse(cfg, msg, cb) {
    if(!msg) return cb()
    msg = msg.trim()
    if(!msg) return cb()

    let options = {
        uri: `http://localhost:${cfg.EBRAIN_AIML_PORT}`,
        method: 'POST',
        body: JSON.stringify({msg:msg}),
    }

    request(options, (err, resp, body) => {
        if(err) cb(err)
        else {
            if(!resp || resp.statusCode != 200) {
                cb(resp_err_1(resp, body))
            } else if(!body) {
                if(isSpecialAIMLMsg(msg)) cb()
                else cb(`No response got to msg: ${msg}!`)
            } else {
                if(body.response) cb(null, kbutil.convertStringToPunctuation(body.response))
                else cb(null, kbutil.convertStringToPunctuation(body))
            }
        }
    })

    function resp_err_1(resp, body) {
        if(!resp) return `No response`
        let msg = body.response ? body.response : body
        return `HTTP response ${resp.statusCode}: ${msg}`
    }
}

/*      understand/
 * In order to set and get KB information from the AIML brain, it
 * supports a set of special 'Set' and 'Get Messages.
 *
 *      outcome/
 * Check if the messages are of this special type so we can ignore them.
 */
function isSpecialAIMLMsg(msg) {
    return (msg.startsWith("EBRAINAIML GET ") ||
        msg.startsWith("EBRAINAIML SET "))
}

/*      outcome/
 * Load existing KBs (triggering any loading event callbacks),
 * and send what info we have to the AIML brain.
 * Periodically check back with it to see if it has more or updated data
 * for us to save back in the KB.
 */
function startKB(cfg) {
    loadedkb = false
    getAvatarID((err,avatarid)=>{
        kbutil.loadExistingKBs(ssbClient,avatarid, (err) => {
            if(err){
                LOADING_CBS.map(cb => cb(err))
                u.showErr(err)
            } else {
                loadedkb = true
                u.showMsg(`KB data loaded from Everchain`)
                LOADING_CBS.map(cb => cb())
                populateFrom(kbutil.getAs(), cfg)
                periodicallyUpdate(cfg)
            }
        })
    })
    
}

/*      outcome/
 * Periodically check if the AIML brain has updated KB answers and save
 * them.
 * NB: Since simple text file format cannot handle multi-line, replace
 * with a end-of-sentence period (.).
 */
function periodicallyUpdate(cfg) {
    setInterval(() => {
        let as = kbutil.getAs()
        let slots = []
        for(let a in as) {
            slots.push(a)
        }
        get_kb_info_ndx_1(as, slots, 0, false)
    }, cfg.EBRAIN_AIML_UPDATE_POLL_FREQ)

    function get_kb_info_ndx_1(as, slots, ndx, updated) {
        if(ndx >= slots.length) return save_if_1(as, updated)
        let slot = slots[ndx]
        let val = as[slot]
        let cmd = `EBRAINAIML GET ${slot}`
        getAIMLResponse(cfg, cmd, (err, resp) => {
            if(err) u.showErr(err)
            else {
                if(resp && resp != val) {
                    updated = true
                    as[slot] = resp
                }
            }
            get_kb_info_ndx_1(as, slots, ndx+1, updated)
        })
    }

    function save_if_1(as, updated) {
        if(!updated) return
        u.showMsg(`Updating KB with info from AIML...`)
        kbutil.saveAns(ssbClient, as, (err) => {
            if(err) u.showErr(err)
        })
    }
}

/*      outcome/
 * Try to set any info we have from the KB. If we fail, try again after
 * some time because the server maybe hasn't started yet. Give up after
 * trying 100 times.
 */
function populateFrom(as, cfg) {
    let numtries = 100

    u.showMsg(`Populating the AIML brain with KB info...`)
    let slots = []
    for(let k in as) {
        slots.push(k)
    }
    set_kb_ndx_var_1(slots, 0)

    function set_kb_ndx_var_1(slots, ndx) {
        if(ndx >= slots.length) return
        let slot = slots[ndx]
        if(as[slot]) {
            set_kb_var_1(slot, as[slot], (err) => {
                if(err) {
                    u.showErr(err)
                    numtries--
                    if(numtries <= 0) {
                        u.showErr(`Giving up...`)
                    } else {
                        setTimeout(() => {
                            set_kb_ndx_var_1(slots, ndx)
                        }, cfg.EBRAIN_AIML_STARTUP_DELAY)
                    }
                } else {
                    set_kb_ndx_var_1(slots, ndx+1)
                }
            })
        } else {
            set_kb_ndx_var_1(slots, ndx+1)
        }
    }

    /*      outcome/
     * We set the AIML variables with
     * commands of the form:
     *      EBRAINAIML SET ${name} ${value}
     *
     *      understand/
     * The AIML commands are created in
     * the `aim/set-variables.xml` file.
     */
    function set_kb_var_1(slot, val, cb) {
        let cmd = `EBRAINAIML SET ${slot} ${val}`
        u.showMsg(`Setting ${slot} = ${val}`)
        getAIMLResponse(cfg, cmd, (err, resp) => {
            if(err) cb(err)
            else {
                u.showMsg(`Set!`)
                cb()
            }
        })
    }
}

main()
