'use strict'
const cote = require('cote')({statusLogsEnabled:false})
const u = require('elife-utils')
const pm2 = require('pm2')
const fs = require('fs')
const path = require('path')
const request = require('request')

const aimlTemplateUtil = require('./aiml-template-util')

/*      understand/
 * This is the main entry point where we start
 * the AIML server, our own microservice, and
 * the knowledge base server.
 */
function main() {
    let cfg = loadConfig()
    u.showMsg(`Starting aiml-server...`)
    startAIMLServer(cfg)
    u.showMsg(`Starting microservice...`)
    startMicroservice(cfg)
    u.showMsg(`Starting Knowledge Base...`)
    startKB(cfg)
    let path ='/data/kb-template/'
    aimlTemplateUtil.addKBTemplate(path)
}

/*      outcome/
 * Load the configuration (from environment variables) or defaults
 */
function loadConfig() {
    let cfg = {};

    if(process.env.EBRAIN_AIML_PORT) {
        cfg.EBRAIN_AIML_PORT = process.env.EBRAIN_AIML_PORT
    } else {
        cfg.EBRAIN_AIML_PORT = "8765"
    }

    if(process.env.EBRAIN_AIML_KB) {
        cfg.KB = process.env.EBRAIN_AIML_KB
    } else {
        cfg.KB = "/data/kb.txt"
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

const ssbClient = new cote.Requester({
    name: 'ebrain-aiml -> SSB',
    key: 'everlife-ssb-svc',
})

/*      outcome/
 * Use PM2 to start the python AIML server
 */
function startAIMLServer(cfg) {
    pm2.connect((err) => {
        if(err) u.showErr(err)
        else start_aiml_server_1(u.showErr)
    })

    function start_aiml_server_1(cwd, cb) {
        pm2.start ({
            name: 'aiml-server',
            script: "serve.py",
            cwd: './aiml',
            log: path.join(__dirname, 'logs', `aiml-server.log`),
        }, cb)
    }
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

    ms.on('user-msg', (req, cb) => {
        getAIMLResponse(cfg, req.msg, cb)
    })
}

/*      outcome/
 * Make a HTTP call to our AIML brain
 * to get a response to the message
 */
function getAIMLResponse(cfg, msg, cb) {
    if(!msg) return cb()
    msg = msg.trim()
    if(!msg) return cb()
    
    if(msg.replace(' ','').startsWith('/install_kb_template')){
        let kb_type = msg.substring('/install_kb_template '.length).trim()
        aimlTemplateUtil.installKBTemplate(kb_type,(err,res)=>{
            if(err) cb(null, 'KB Template installation failed')
            else cb(null,`${kb_type} KB Template installed`)
        })
    }else{
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
                    if(body.response) cb(null, body.response)
                    else cb(null, body)
                }
            }
        })

        function resp_err_1(resp, body) {
            if(!resp) return `No response`
            let msg = body.response ? body.response : body
            return `HTTP response ${resp.statusCode}: ${msg}`
        }
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
 * Load the KB and send what info we have to the AIML brain.
 * Periodically check back with it to see if it has more or updated data
 * for us to save back in the KB.
 */
function startKB(cfg) {
    loadKB(cfg, (err, kb) => {
        if(err) u.showErr(err)
        else {
            show_parse_errors_1(kb)
            populateFrom(kb, cfg)
            periodicallyUpdate(kb, cfg)
        }
    })

    function show_parse_errors_1(kb) {
        for(let i = 0;i < kb.length;i++) {
            if(kb.error) u.showErr(kb.error)
        }
    }
}

/*      outcome/
 * Periodically check if the AIML brain has updated KB answers and save
 * them.
 * NB: Since simple text file format cannot handle multi-line, replace
 * with a end-of-sentence period (.).
 */
function periodicallyUpdate(kb, cfg) {
    setInterval(() => {
        get_kb_info_ndx_1(0, false)
    }, cfg.EBRAIN_AIML_UPDATE_POLL_FREQ)

    function get_kb_info_ndx_1(ndx, updated) {
        if(ndx >= kb.length) return save_if_1(updated)
        let item = kb[ndx]
        if(!item.name) return get_kb_info_ndx_1(ndx+1, updated)
        let val = item.value
        let cmd = `EBRAINAIML GET ${item.name}`
        getAIMLResponse(cfg, cmd, (err, resp) => {
            if(err) u.showErr(err)
            else {
                if(resp && resp != val) {
                    updated = true
                    item.value = resp.trim().replace(/[\r\n]+/g, ". ")
                    item.line = `${item.name} : ${item.value}`
                }
            }
            get_kb_info_ndx_1(ndx+1, updated)
        })
    }

    function save_if_1(updated) {
        if(!updated) return
        u.showMsg(`Updating KB with info from AIML...`)
        let lines = kb.map((item) => item.line)
        let data = lines.join('\n')
        saveKBInEverchain(kb)
    }
}

/*      outcome/
 * Try to set any info we have from the KB. If we fail, try again after
 * some time because the server maybe hasn't started yet. Give up after
 * trying 100 times.
 */
function populateFrom(kb, cfg) {
    let numtries = 100

    u.showMsg(`Populating the AIML brain with KB info...`)
    set_kb_ndx_var_1(0)

    function set_kb_ndx_var_1(ndx) {
        if(ndx >= kb.length) return
        let item = kb[ndx]
        if(item.name && item.value) {
            set_kb_var_1(item, (err) => {
                if(err) {
                    u.showErr(err)
                    numtries--
                    if(numtries <= 0) {
                        u.showErr(`Giving up...`)
                    } else {
                        setTimeout(() => {
                            set_kb_ndx_var_1(ndx)
                        }, cfg.EBRAIN_AIML_STARTUP_DELAY)
                    }
                } else {
                    set_kb_ndx_var_1(ndx+1)
                }
            })
        } else {
            set_kb_ndx_var_1(ndx+1)
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
    function set_kb_var_1(item, cb) {
        let cmd = `EBRAINAIML SET ${item.name} ${item.value}`
        u.showMsg(`Setting ${item.name} = ${item.value}`)
        getAIMLResponse(cfg, cmd, (err, resp) => {
            if(err) cb(err)
            else {
                u.showMsg(`Set!`)
                cb()
            }
        })
    }
}

/*      outcome/
 * The knowlege base consists of
 *      name: value
 * pairs that we load from the
 * file. We ignore comment lines
 * (start with #) and blank lines
 */
function loadKB(cfg, cb) {
    loadKBFromEverchain((err,chainKB)=>{

        fs.readFile(cfg.KB, (err, data) => {
            if(err) cb(err)
            else {
                let kb = []
                if(chainKB)
                    kb = chainKB
                let lines = data.toString().split(/[\r\n]+/)
                for(let i = 0;i < lines.length;i++) {
                    let line = lines[i].trim()
                    let item = { line: line }
                    if(line && !line.startsWith("#")) {
                        let pt = line.indexOf(":")
                        if(pt < 1) {
                            item.error = `Error finding name:value on line: ${line}`
                        } else {
                            item.name = line.substring(0, pt).trim()
                            item.value= line.substring(pt+1).trim()
                        }
                    }
                    let isNewKB = true 
                    if(chainKB)
                        for(let chainItem of chainKB){
                            if((!chainItem.name && chainItem.name === item.name)
                                || chainItem.line === item.line)
                                isNewKB = false
                        }
                    if(isNewKB)
                        kb.push(item)
                    
                }
                cb(null, kb)
            }
        })
    })
}
function loadKBFromEverchain(cb){
    ssbClient.send({ type: 'msg-by-type', msgtype: 'kb-msg' }, (err, msgs) => {
        if(err) cb(err,null)
        else {
            let latestTimeStamp = 0
            let kb;
            for(let msg of msgs){
                if(msg.value.timestamp > latestTimeStamp){
                    kb = msg.value.content.kb
                    latestTimeStamp = msg.value.timestamp
                }
            }
            cb(null, kb)
        }
    })
}

function saveKBInEverchain(kb){
    ssbClient.send({ type: 'new-pvt-log', msg: { type : 'kb-msg', kb : kb}}, (err) => {
        if(err) u.showErr(err)
    })
}

main()