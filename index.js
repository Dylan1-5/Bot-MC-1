import './config.js'
import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys'
import P from 'pino'
import chalk from 'chalk'
import { Boom } from '@hapi/boom'
import fs from 'fs'
import yts from 'yt-search'
import fetch from 'node-fetch'

const decodeJid = (jid) => {
    if (!jid) return jid
    if (/:\d+@/gi.test(jid)) {
        let decode = jid.match(/:(\d+)@/gi) || []
        return jid.replace(decode[0], '@')
    }
    return jid
}

async function isValidPhoneNumber(number) {
    try {
        let num = String(number).trim()
        num = num.replace(/[\s\-()]/g, '')
        if (!num.startsWith('+')) num = '+' + num
        if (num.startsWith('+52')) {
            const digits = num.substring(3)
            if (num.startsWith('+521') && num.length === 13) return /^\+521[0-9]{10}$/.test(num)
            else if (num.length === 12) {
                const numDigits = digits.replace(/\D/g, '')
                if (numDigits.length === 10) return true
            }
            else if (digits.length === 10 && /^[0-9]{10}$/.test(digits)) return true
        }
        return /^\+[1-9]\d{9,14}$/.test(num)
    } catch (error) {
        return false
    }
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('sessions')
    const { version } = await fetchLatestBaileysVersion()
    
    let opcion = '2' 

    console.info = () => {}

    const conn = makeWASocket({
        version,
        logger: P({ level: 'silent' }),
        printQRInTerminal: false,
        auth: { 
            creds: state.creds, 
            keys: makeCacheableSignalKeyStore(state.keys, P({ level: 'silent' })) 
        },
        browser: ["Ubuntu", "Chrome", "110.0.5481.178"],
        syncFullHistory: false,
        markOnlineOnConnect: true
    })
    
    conn.ev.on('creds.update', saveCreds)

    if (!fs.existsSync(`./sessions/creds.json`) && opcion === '2' && !conn.authState.creds.registered) {
        let phoneNumber = process.env.NUMERO || ""; 
        
        if (!phoneNumber) {
            console.log(chalk.red('\n   [AVISO] No se detectó variable NUMERO en Railway, esperando conexión...\n'));
        } else {
            phoneNumber = String(phoneNumber).replace(/\D/g, '')
            if (!phoneNumber.startsWith('+')) phoneNumber = `+${phoneNumber}`

            if (await isValidPhoneNumber(phoneNumber)) {
                let addNumber = phoneNumber.replace(/\D/g, '')
                console.log(chalk.cyan(`\n   Generando código de vinculación para: +${addNumber}...`))
                
                setTimeout(async () => {
                    let codeBot = await conn.requestPairingCode(addNumber)
                    codeBot = codeBot.match(/.{1,4}/g)?.join("-") || codeBot
                    console.log(chalk.green('\n   ======================================'))
                    console.log(chalk.green('   TU CÓDIGO DE VINCULACIÓN ES:'))
                    console.log(chalk.white(`   👉   ${codeBot}   👈`))
                    console.log(chalk.green('   ======================================\n'))
                }, 3000)
            }
        }
    }

    conn.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0]
            if (!msg || !msg.message) return

            const from = msg.key.remoteJid
            const sender = msg.key.participant || msg.key.remoteJid
            const pushName = msg.pushName || 'Usuario'

            const type = Object.keys(msg.message)[0]
            const body = (type === 'conversation' ? msg.message.conversation : 
                          type === 'extendedTextMessage' ? msg.message.extendedTextMessage.text : 
                          type === 'imageMessage' ? msg.message.imageMessage.caption : 
                          type === 'videoMessage' ? msg.message.videoMessage.caption : '') || ''

            console.log(chalk.gray(`[${new Date().toLocaleTimeString()}]`), chalk.cyan(`${pushName}:`), chalk.white(body || '[MEDIA]'))

            const prefixList = Array.isArray(global.prefix) ? global.prefix : [global.prefix]
            const usedPrefix = prefixList.find(p => body.startsWith(p))
            
            if (usedPrefix !== undefined) {
                const args = body.slice(usedPrefix.length).trim().split(/ +/)
                const command = args.shift().toLowerCase()
                const text = args.join(' ')
                
                const reply = (txt) => conn.sendMessage(from, { text: txt }, { quoted: msg })
                
                switch (command) {
                    case 'menu':
                    case 'help':
                    case 'ayuda':
                        const menu = `¡Hola! *${pushName}*, soy *${global.botName}*

● Prefijo: ${usedPrefix}
● Owner: ${global.dev}

――――――――――――――――――――

[ COMANDOS ]
● ${usedPrefix}ping
> Ver velocidad del bot
● ${usedPrefix}owner
> Información de creador 
● ${usedPrefix}status
> Ver estado
● ${usedPrefix}play
> Descargar audio 
● ${usedPrefix}tag
> Mencionar a todos 
――――――――――――――――――――`
                        
                        await conn.sendMessage(from, { 
                            image: { url: global.banner }, 
                            caption: menu
                        }, { quoted: msg })
                        break
                        
                    case 'status':
                    case 'estado':
                        const uptime = process.uptime()
                        const h = Math.floor(uptime / 3600)
                        const m = Math.floor((uptime % 3600) / 60)
                        const s = Math.floor(uptime % 60)
                        const ram = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)
                        
                        await conn.sendMessage(from, { 
                            text: `*ESTADO DEL BOT*\n\n• Uptime: ${h}h ${m}m ${s}s\n• RAM: ${ram} MB\n• Node.js: ${process.version}\n• Owner: ${global.dev}`
                        }, { quoted: msg })
                        break
                        
                    case 'ping':
                    case 'p':
                        const start = Date.now()
                        const { key } = await conn.sendMessage(from, { text: 'Calculando...' }, { quoted: msg })
                        await conn.sendMessage(from, { text: `PONG!\nLatencia: ${Date.now() - start}ms`, edit: key })
                        break
                        
                    case 'owner':
                    case 'creador':
                    case 'dueño':
                        const ownerNumber = global.owner[0][0]
                        const ownerName = global.dev
                        await conn.sendMessage(from, { 
                            text: `INFORMACION OWNER\n\nNombre: ${ownerName}\nContacto: ${ownerNumber}\n\n――――――――――――――――――――`
                        }, { quoted: msg })
                        break

                    case 'tag':
                    case 'all':
                    case 'invocar': 
                    case '`': 
                        try {
                            if (!from.endsWith('@g.us')) {
                                return await conn.sendMessage(from, { text: '「✎」 Este comando solo funciona en grupos.' }, { quoted: msg })
                            }
                            const groupMetadata = await conn.groupMetadata(from)
                            const participants = groupMetadata.participants
                            const senderNumber = sender.replace(/\D/g, '')
                            const botNumber = String(conn.user?.id || '').replace(/\D/g, '')
                            const ownerNumberConfig = String(global.owner?.[0]?.[0] || '').replace(/\D/g, '')
                            const isUserAdmin = participants.find(p => p.id === sender)?.admin !== null
                            const isOwner = senderNumber === botNumber || senderNumber === ownerNumberConfig || pushName === global.dev

                            if (!isUserAdmin && !isOwner) {
                                return await conn.sendMessage(from, { text: '「✎」 Este comando es solo para Administradores del grupo.' }, { quoted: msg })
                            }

                            const targetParticipants = participants.map(p => p.id).filter(Boolean)
                            const contextInfo = msg.message?.extendedTextMessage?.contextInfo || msg.message?.[type]?.contextInfo
                            const quotedMsg = contextInfo?.quotedMessage

                            if (quotedMsg) {
                                const quotedType = Object.keys(quotedMsg)[0]
                                const contentToForward = {}
                                contentToForward[quotedType] = quotedMsg[quotedType]
                                
                                if (!contentToForward.contextInfo) contentToForward.contextInfo = {}
                                contentToForward.contextInfo.mentionedJid = targetParticipants

                                let customText = args.join(' ').trim()
                                if (customText) {
                                    if (quotedType === 'conversation') {
                                        contentToForward.conversation = `${customText}\n\n${contentToForward.conversation}`
                                    } else if (quotedType === 'extendedTextMessage') {
                                        contentToForward.extendedTextMessage.text = `${customText}\n\n${contentToForward.extendedTextMessage.text}`
                                    } else if (contentToForward[quotedType] && 'caption' in contentToForward[quotedType]) {
                                        contentToForward[quotedType].caption = `${customText}\n\n${contentToForward[quotedType].caption || ''}`
                                    }
                                }
                                return await conn.sendMessage(from, contentToForward)
                            }

                            let textMessage = args.join(' ').trim()
                            if (!textMessage) {
                                return await conn.sendMessage(from, { 
                                    text: `「✎」 Uso correcto:\n\n> *${usedPrefix + command}* mensaje`
                                }, { quoted: msg })
                            }
                            await conn.sendMessage(from, {
                                text: textMessage,
                                mentions: targetParticipants
                            })
                        } catch (e) {
                            reply(`Error: ${e.message}`)
                        }
                        break

                    case 'play':
                    case 'mp3':
                    case 'ytmp3':
                    case 'ytaudio':
                    case 'playaudio':
                        try {
                            if (!args[0]) {
                                return await conn.sendMessage(from, { text: '《✧》Por favor, menciona el nombre o URL del video.' }, { quoted: msg })
                            }
                            const input_text = args.join(' ').trim()
                            const search = await yts(input_text)
                            const video_info = search.videos?.[0]

                            if (!video_info) return reply('No se encontró un video válido.')

                            const url = video_info.url
                            const title = video_info.title
                            const thumbnail = video_info.image || video_info.thumbnail || null
                            const views = Number(video_info.views || 0).toLocaleString('es-HN')
                            const channel = video_info.author?.name || 'Desconocido'

                            const info_message = `➩ Descargando › *${title}*

> ❖ Canal › *${channel}*
> ⴵ Duración › *${video_info.timestamp || 'Desconocido'}*
> ❒ Enlace › *${url}*`

                            if (thumbnail) {
                                await conn.sendMessage(from, { image: { url: thumbnail }, caption: info_message }, { quoted: msg })
                            } else {
                                await conn.sendMessage(from, { text: info_message }, { quoted: msg })
                            }

                            // Descarga directa por API externa para evitar tuberías rotas y fallos de FFmpeg
                            const res = await fetch(`https://api.zenkey.my.id/api/download/ytmp3?url=${encodeURIComponent(url)}`)
                            const json = await res.json()
                            
                            if (!json.status || !json.result?.download) {
                                throw new Error('No se pudo obtener el flujo de audio actual desde los servidores.')
                            }

                            await conn.sendMessage(from, {
                                audio: { url: json.result.download },
                                fileName: `${title}.mp3`,
                                mimetype: 'audio/mpeg'
                            }, { quoted: msg })
                        } catch (e) {
                            reply(`Error: ${e.message}`)
                        }
                        break
                        
                    default:
                        reply(`Comando no encontrado: *${command}*\n\nUsa *${usedPrefix}help*`)
                        break
                }
            }
        } catch (err) { 
            console.error(err) 
        }
    })

    conn.ev.on('connection.update', (u) => {
        if (u.connection === 'open') {
            console.log(chalk.cyan(`\n    ${global.botName?.toUpperCase() || 'BOT'} CONECTADO AL 100%\n`))
        }
        if (u.connection === 'close' && new Boom(u.lastDisconnect?.error)?.output.statusCode !== DisconnectReason.loggedOut) {
            startBot()
        }
    })
}

startBot()
