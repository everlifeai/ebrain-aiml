'use strict'
const cote = require('cote')({statusLogsEnabled:false})
const u = require('@elife/utils')

function main() {
    let msg = get_user_input_1()
    if(msg) {
        sendMsg(msg, (err, resp) => {
            if(err) u.showErr(err)
            else u.showMsg(resp)
        })
    }
}

function get_user_input_1() {
    if(process.argv.length < 3) return
    let msg = []
    for(let i = 2;i < process.argv.length;i++) {
        msg.push(process.argv[i])
    }
    return msg.join(" ")
}

const ms = new cote.Requester({
    name: 'Tester -> Everlife AIML Brain',
    key: 'ebrain-aiml',
})

function sendMsg(msg, cb) {
    ms.send({type:'user-msg', msg:msg}, cb)
}

main()
