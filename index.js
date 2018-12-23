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
 * populate the AIML variables with our
 * knowledge base.
 */
function main() {
    let cfg = loadConfig()
    u.showMsg(`Starting aiml-server...`)
    startAIMLServer(cfg)
    u.showMsg(`Starting microservice...`)
    startMicroservice(cfg)
    u.showMsg(`Populating Knowledge Base...`)
    populateKnowledgeBase(cfg)
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
        cfg.EBRAIN_AIML_STARTUP_DELAY = 3*1000
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
            if(body.response) cb(null, body.response)
            else cb(null, body)
        }
    })
}

/*      outcome/
 * Load the Knowledge Base and use it to populate
 * the information in our AIML brain. Give the server
 * a couple of seconds to start before we begin.
 */
function populateKnowledgeBase(cfg) {
    setTimeout(() => {
        loadKB(cfg, (err, kb) => {
            if(err) u.showErr(err)
            else {
                for(let i = 0;i < kb.length;i++) {
                    set_kb_var_1(kb[i])
                }
            }
        })
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
                if(!line || line.startsWith("#")) continue
                let pt = line.indexOf(":")
                if(pt < 1) {
                    cb(`Error finding name:value on line: ${line}`)
                } else {
                    let item = {
                        name: line.substring(0, pt).trim(),
                        value: line.substring(pt+1).trim(),
                    }
                    kb.push(item)
                }
            }
            cb(err, kb)
        }
    })
}

main()
