import './config.js'
import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys'
import P from 'pino'
import chalk from 'chalk'
import { Boom } from '@hapi/boom'
import fs from 'fs'
import yts from 'yt-search'
import fetch from 'node-fetch'
import crypto from 'crypto'

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

// ==========================================
// MOTOR DE DESCARGA AVANZADO (SOYMAYCOL SYSTEM)
// ==========================================
const getVideoId = url => {
    const match = url.match(/(?:v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]{11})/)
    if (!match) throw new Error('No se pudo extraer el videoId')
    return match[1]
}

const S = s => crypto.createHash('sha256').update(s).digest('hex')
const HM = (k, d) => crypto.createHmac('sha256', k).update(d).digest('hex')

async function descargarYT(youtubeUrl, formato = 'mp3') {
    const id = getVideoId(youtubeUrl)
    const B = 'https://embed.dlsrv.online'
    const calidad = formato === 'mp4' ? '720' : '320'
    
    const H = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': B,
        'Referer': `${B}/v1/full?videoId=${id}`,
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin'
    }

    const d = {
        ua: H['User-Agent'], lang: 'en-US', languages: 'en-US,en',
        screen: { w: 1920, h: 1080, cd: 24 }, tzOffset: '-300',
        tz: 'America/New_York', hc: '12', dm: '8', chrome: 'true',
        canvasHash: '', webdriver: 'false', GPU: '', gpuVendor: ''
    }

    const fp = S([d.ua, d.lang, d.languages, `${d.screen.w}x${d.screen.h}x${d.screen.cd}`, d.tzOffset, d.tz, d.hc, d.dm, d.chrome, d.canvasHash].join('|'))

    const p = await (await fetch(`${B}/v1/full?videoId=${id}`, { headers: H })).text()
    const tknMatch = p.match(/data-token="([^"]+)"/)
    if (!tknMatch) throw new Error('No se pudo obtener el token de inicialización.')
    const tkn = tknMatch[1]

    const ch = await (await fetch(`${B}/api/challenge`, { method: 'POST', headers: H })).json()

    let n = 0n
    const pfx = '0'.repeat(ch.difficulty)
    while (!S(`${ch.salt}:${ch.ts}:${n}`).startsWith(pfx)) n++

    const v = await (await fetch(`${B}/api/verify`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({
            initToken: tkn, fpHash: fp, fpDetails: d, salt: ch.salt, ts: ch.ts,
            signature: ch.signature, nonce: n.toString(),
            telemetry: { interactions: 10, timeToVerify: 5000 }
        })
    })).json()

    if (!v.token) throw new Error('Verificación de bypass fallida.')

    const ts = Date.now().toString()
    const sig = HM(v.token.slice(-32), `${ts}:${id}`)

    const endpoint = formato === 'mp4' ? '/api/download/mp4' : '/api/download/mp3'

    const dl = await (await fetch(`${B}${endpoint}`, {
        method: 'POST',
        headers: {
            ...H,
            'Authorization': `Bearer ${v.token}`,
            'x-fp': fp, 'x-ts': ts, 'x-sig': sig
        },
        body: JSON.stringify({ videoId: id, format: formato, quality: calidad })
    })).json()

    if (!dl.url) throw new Error('La API de bypass no devolvió un enlace de descarga válido.')
    return dl.url
}

// ==========================================
// FUNCIÓN PRINCIPAL DEL BOT
// ==========================================
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('sessions')
    const { version } = await fetchLatestBaileysVersion()
    
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

    if (!fs.existsSync(`./sessions/creds.json`) && !conn.authState.creds.registered) {
        let phoneNumber = process.env.NUMERO || ""; 
        if (phoneNumber) {
            phoneNumber = String(phoneNumber).replace(/\D/g, '')
            if (await isValidPhoneNumber(phoneNumber)) {
                console.log(chalk.cyan(`\n   Generando código de vinculación para: +${phoneNumber}...`))
                setTimeout(async () => {
                    let codeBot = await conn.requestPairingCode(phoneNumber)
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

            // CORRECCIÓN ANTIDOBLE: Evita procesar tus propios mensajes salientes enviados desde otros dispositivos vinculados, a menos que sea un chat contigo mismo de forma única.
            if (msg.key.fromMe && msg.key.remoteJid !== conn.user?.id && !msg.key.remoteJid.endsWith('@g.us')) return

            const from = msg.key.remoteJid
            const sender = msg.key.participant || msg.key.remoteJid
            const pushName = msg.pushName || 'Usuario'

            const type = Object.keys(msg.message)[0]
            
            // Omitir mensajes de protocolo o estados para que no causen bucles
            if (type === 'protocolMessage' || type === 'senderKeyDistributionMessage') return

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
                const reply = (text) => conn.sendMessage(from, { text }, { quoted: msg })
                
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
● ${usedPrefix}play2
> Descargar video 
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
                            text: `INFORMACION OWNER

Nombre: ${ownerName}
Contacto: ${ownerNumber}

――――――――――――――――――――` 
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
                                    text: `「✎」 Uso correcto:\n\n> *${usedPrefix + command}* mensaje\n> O responde a un archivo/mensaje usando *${usedPrefix + command}*` 
                                }, { quoted: msg })
                            }

                            await conn.sendMessage(from, {
                                text: textMessage,
                                mentions: targetParticipants
                            }, { quoted: msg })

                        } catch (e) {
                            await conn.sendMessage(from, { text: `> An unexpected error occurred while executing command *${usedPrefix + command}*.\n> [Error: *${e.message}*]` }, { quoted: msg })
                        }
                        break

                    case 'play':
                    case 'mp3':
                    case 'ytmp3':
                    case 'ytaudio':
                    case 'playaudio':
                        try {
                            if (!args[0]) {
                                return await conn.sendMessage(from, { text: '《✧》Por favor, menciona el nombre o URL del video que deseas descargar' }, { quoted: msg })
                            }

                            const input_text = args.join(' ').trim()
                            let videoIdBypass = null
                            try { videoIdBypass = getVideoId(input_text) } catch {}
                            
                            const query = videoIdBypass ? `https://youtu.be/${videoIdBypass}` : input_text
                            let url = query
                            let title = 'audio'
                            let thumbnail = null

                            try {
                                const search = await yts(query)
                                const video_info = search.videos?.[0] || search.all?.find(v => v.type === 'video') || null

                                if (video_info) {
                                    url = video_info.url || `https://youtu.be/${video_info.videoId}`
                                    title = video_info.title || title
                                    thumbnail = video_info.image || video_info.thumbnail || null

                                    const views = Number(video_info.views || 0).toLocaleString('es-HN')
                                    const channel = video_info.author?.name || video_info.author || 'Desconocido'

                                    const info_message = `➩ Descargando › *${title}*

> ❖ Canal › *${channel}*
> ⴵ Duración › *${video_info.timestamp || 'Desconocido'}*
> ❀ Vistas › *${views}*
> ✩ Publicado › *${video_info.ago || 'Desconocido'}*
> ❒ Enlace › *${url}*`

                                    if (thumbnail) {
                                        await conn.sendMessage(from, { image: { url: thumbnail }, caption: info_message }, { quoted: msg })
                                    } else {
                                        await conn.sendMessage(from, { text: info_message }, { quoted: msg })
                                    }
                                }
                            } catch {}

                            const enlaceDirectoMp3 = await descargarYT(url, 'mp3')

                            await conn.sendMessage(from, {
                                audio: { url: enlaceDirectoMp3 },
                                fileName: `${title}.mp3`,
                                mimetype: 'audio/mpeg'
                            }, { quoted: msg })

                        } catch (e) {
                            await conn.sendMessage(from, { text: `> An unexpected error occurred while executing command *${usedPrefix + command}*.\n> [Error: *${e.message}*]` }, { quoted: msg })
                        }
                        break

                    case 'play2':
                    case 'mp4':
                    case 'ytmp4':
                    case 'ytvideo':
                    case 'playvideo':
                        try {
                            if (!args[0]) {
                                return await conn.sendMessage(from, { text: '《✧》Por favor, menciona el nombre o URL del video que deseas descargar' }, { quoted: msg })
                            }

                            const input_text = args.join(' ').trim()
                            let videoIdBypass2 = null
                            try { videoIdBypass2 = getVideoId(input_text) } catch {}
                            
                            const query = videoIdBypass2 ? `https://youtu.be/${videoIdBypass2}` : input_text
                            let url = query
                            let title = 'video'
                            let thumbnail = null

                            try {
                                const search = await yts(query)
                                const video_info = search.videos?.[0] || search.all?.find(v => v.type === 'video') || null

                                if (video_info) {
                                    url = video_info.url || `https://youtu.be/${video_info.videoId}`
                                    title = video_info.title || title
                                    thumbnail = video_info.image || video_info.thumbnail || null

                                    const views = Number(video_info.views || 0).toLocaleString('es-HN')
                                    const channel = video_info.author?.name || video_info.author || 'Desconocido'

                                    const info_message = `➩ Descargando Video › *${title}*

> ❖ Canal › *${channel}*
> ⴵ Duración › *${video_info.timestamp || 'Desconocido'}*
> ❀ Vistas › *${views}*
> ✩ Publicado › *${video_info.ago || 'Desconocido'}*
> ❒ Enlace › *${url}*`

                                    if (thumbnail) {
                                        await conn.sendMessage(from, { image: { url: thumbnail }, caption: info_message }, { quoted: msg })
                                    } else {
                                        await conn.sendMessage(from, { text: info_message }, { quoted: msg })
                                    }
                                }
                            } catch {}

                            const enlaceDirectoMp4 = await descargarYT(url, 'mp4')

                            await conn.sendMessage(from, {
                                video: { url: enlaceDirectoMp4 },
                                fileName: `${title}.mp4`,
                                mimetype: 'video/mp4'
                            }, { quoted: msg })

                        } catch (e) {
                            await conn.sendMessage(from, { text: `> An unexpected error occurred while executing command *${usedPrefix + command}*.\n> [Error: *${e.message}*]` }, { quoted: msg })
                        }
                        break
                        
                    default:
                        reply(`Comando no encontrado: *${command}*\n\nUsa *${usedPrefix}help* para ver los comandos disponibles`)
                        break
                }
            }
        } catch (err) { console.error(err) }
    })

    conn.ev.on('connection.update', (u) => {
        if (u.connection === 'open') {
            console.log(chalk.cyan('   -------------------------------'))
            console.log(chalk.cyan(`    ${global.botName.toUpperCase()} CONECTADO`))
            console.log(chalk.cyan('   -------------------------------'))
            console.log(chalk.white(`   Owner: ${global.dev}`))
            console.log(chalk.white(`   Prefijo: ${global.prefix[0]}`))
            console.log(chalk.white('   Base: Corvette Script'))
            console.log(chalk.white('   GitHub: github.com/ScriptGray'))
            console.log(chalk.cyan('   -------------------------------\n'))
        }
        if (u.connection === 'close' && new Boom(u.lastDisconnect?.error)?.output.statusCode !== DisconnectReason.loggedOut) {
            console.log(chalk.white('   Reconectando...'))
            startBot()
        }
    })
}

startBot()
