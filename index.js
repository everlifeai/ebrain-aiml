'use strict'
const cote = require('cote')({statusLogsEnabled:false})
const pm2 = require('pm2')
const u = require('elife-utils')
const path = require('path')
const request = require('request')


/*      understand/
 * This is the main entry point where we start
 * the AIML server, and our own microservice.
 */
function main() {
    let conf = loadConfig()
    u.showMsg(`Starting aiml-server...`)
    startAIMLServer(cfg)
    u.showMsg(`Starting microservice...`)
    startMicroservice(cfg)
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
        if(!req.msg) return
        let msg = req.msg.trim()
        if(!msg) return

        let options = {
            uri: `http://localhost:${EBRAIN_AIML_PORT}`,
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
    })
}

main()
