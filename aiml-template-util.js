'use strict'
const fs = require('fs')
const junk = require('junk')
const cote = require('cote')
const u = require('elife-utils')


let path = '/data/kb-template/'

const ssbClient = new cote.Requester({
    name: 'aiml-template-util -> SSB',
    key: 'everlife-ssb-svc',
})

/**
 * Get all the aiml template from aiml-template dir
 * 
 */
module.exports.addKBTemplate = function (path){

    fs.readdir(path, (err, files) => {
        if(err) u.showErr(err)
        else{
            //Ignore system generated files 
            files = files.filter(junk.not)
            for(let file  of files){
                fs.stat(path + file,(err,stat)=>{
                    if(err) u.showErr(err)
                    else if(stat.isDirectory){
                        addTemplateToEverChain(path + file, file)
                    }
                    
                })
            }
        }
    });
}
function addTemplateToEverChain(path, kb_type){

    validateKBTemplateExists(kb_type,(err,isExists)=>{
        if(err) u.showErr(err)
        else if(!isExists){
            let filesPath = []
            fs.readdir(path, (err, files)=>{
                if(err) u.showErr(err)
                else{
                    for(let file of files){
                        if(file.endsWith('.aiml'))
                            filesPath.push( path + "/" + file)
                        else if(file.endsWith('.json')){
                            filesPath.push(path +"/"+ file)
                        }
                    }
                    if(filesPath && filesPath.length == 2)
                        publishFiles(filesPath, kb_type)
                }
            })
        }
    })
}

function validateKBTemplateExists(kb_type,cb){

    ssbClient.send({type: 'msg-by-type',msgtype:'kb-template'},(err,msgs)=>{
        if(err) cb(err)
        else{
            for(let msg of msgs){
                if(msg.value.content.text == kb_type){
                    cb(null, true)
                    return
                }
            }
            cb(null, false)
        }
    })
}

function publishFiles(files, kb_type){

    let mentions = [] 
    let loc = 0
    getHashValues(files)
    function getHashValues(files){
        ssbClient.send({type: 'publish-file', filePath: files[loc]},(err,hash)=>{
            if(err){
                loc++;
                if (loc == files.length){
                }else{
                    getHashValues(files)
                }
            }else{
                mentions.push({
                    link: hash,
                    name: files[loc]
                })
                loc++;
                if (loc == files.length){
                    publishFile(mentions, kb_type)
                }else{
                    getHashValues(files)
                }
            }
        })
    }
    function publishFile(mentions,kb_type){

        if(mentions && mentions.length>1){
            ssbClient.send({ type: 'new-msg', msg: {type:'kb-template',text:kb_type,mentions:mentions}},(err)=>{
                if(err) u.showErr(err)
                else u.showMsg('Ok')
            })
        }
    }
}

module.exports.installKBTemplate = function installKBTemplate(templateType,cb){
    let req = {
        type: 'msg-by-type',
        msgtype: 'kb-template'
    }
    
    ssbClient.send(req,(err,msgs)=>{
        if(err) u.showErr(err)
        else{
            for(let msg of msgs){
                if(msg.value.content.text == templateType.trim()){
                    for(let mention of msg.value.content.mentions){
                        ssbClient.send({type: 'get-file-content',hash: mention.link},(err, values)=>{
                            if(err) u.showErr(err)
                            else{
                                if(mention.name.endsWith('.aiml')){
                                    fs.writeFile(__dirname+"/aiml/aiml/botdata/elife/"+templateType+".aiml",new Buffer(values[0]),(err)=>{
                                        if(err) u.showErr(err)
                                        else u.showMsg('file saved')
                                    })
                                }else if(mention.name.endsWith('.json')){
                                    updateKBVariable(new Buffer(values[0]))
                                }
                            }
                        })
                    }
                    cb(null,'Installed kb template')
                    return
                }
            }
        }
    })
}

function updateKBVariable(content){
    getLastestKB((err,kb)=>{
        if(err) u.showErr(err)
        else{
            const obj = JSON.parse(content)
            const keys = Object.keys(obj)
            if(!kb)
                kb = []
            for( let key of keys){
                let item = {}
                item[key] = ''
                let keyContains = false
                for(let k of kb){
                    if(`${key}` in k){
                        keyContains = true
                        break
                    }
                }
                if(!keyContains)
                    kb.push(item)
            }
            ssbClient.send({ type: 'new-pvt-log', msg: { type : 'kb-msg', kb : kb}}, (err) => {
                if(err) u.showErr(err)
            })
        }
    })
}

/**
 *  /outcome
 * Returns the latest message from message List
 */
module.exports.getLatestMsg = function(msgs){
    let latestTimeStamp = 0
    let latestMsg
    for(let msg of msgs){
        if(msg.value.timestamp > latestTimeStamp){
            latestMsg = msg
            latestTimeStamp = msg.value.timestamp
        }
    }
    return latestMsg
}

function getLastestKB(cb){
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