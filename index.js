'use strict'
const cote = require('cote')({statusLogsEnabled:false})
const u = require('elife-utils')
const pm2 = require('pm2')
const fs = require('fs')
const path = require('path')
const request = require('request')


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
        cfg.KB = "kb.txt"
    }

    if(process.env.EBRAIN_AIML_STARTUP_DELAY) {
        cfg.EBRAIN_AIML_STARTUP_DELAY = process.env.EBRAIN_AIML_STARTUP_DELAY
    } else {
        cfg.EBRAIN_AIML_STARTUP_DELAY = 15*1000
    }

    if(process.env.EBRAIN_AIML_UPDATE_POLL_FREQ) {
        cfg.EBRAIN_AIML_UPDATE_POLL_FREQ = process.env.EBRAIN_AIML_UPDATE_POLL_FREQ
    } else {
        cfg.EBRAIN_AIML_UPDATE_POLL_FREQ = 3*60*1000
    }

    return cfg;
}

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

    let options = {
        uri: `http://localhost:${cfg.EBRAIN_AIML_PORT}`,
        method: 'POST',
        body: JSON.stringify({msg:msg}),
    }

    request(options, (err, resp, body) => {
        if(err) cb(err)
        else {
            if(!body) {
                if(isSpecialAIMLMsg(msg)) cb()
                else cb(`No response got to msg: ${msg}!`)
            } else {
                if(body.response) cb(null, body.response)
                else cb(null, body)
            }
        }
    })
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
                    item.value = resp
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
        fs.writeFile(cfg.KB, data, (err) => {
            if(err) u.showErr(err)
        })
    }
}

/*      outcome/
 * Give the server some time to start up then send it any information we
 * have in the KB.
 */
function populateFrom(kb, cfg) {
    setTimeout(() => {
        u.showMsg(`Populating the AIML brain with KB info...`)
        for(let i = 0;i < kb.length;i++) {
            let item = kb[i]
            if(item.name && item.value) set_kb_var_1(item)
        }
    }, cfg.EBRAIN_AIML_STARTUP_DELAY)

    /*      outcome/
     * We set the AIML variables with
     * commands of the form:
     *      EBRAINAIML SET ${name} ${value}
     *
     *      understand/
     * The AIML commands are created in
     * the `aim/set-variables.xml` file.
     */
    function set_kb_var_1(item) {
        let cmd = `EBRAINAIML SET ${item.name} ${item.value}`
        getAIMLResponse(cfg, cmd, (err, resp) => {
            if(err) u.showErr(err)
            else u.showMsg(resp)
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
    fs.readFile(cfg.KB, (err, data) => {
        if(err) cb(err)
        else {
            let kb = []
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
                kb.push(item)
            }
            cb(null, kb)
        }
    })
}

main()
