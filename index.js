import './config.js'
import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys'
import P from 'pino'
import chalk from 'chalk'
import { Boom } from '@hapi/boom'
import fs, { existsSync } from 'fs'
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import readline from 'readline'
import yts from 'yt-search'
import fetch from 'node-fetch'
import { spawn } from 'child_process'
import { Readable } from 'stream'

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const question = (text) => new Promise((resolve) => rl.question(text, resolve))

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

function formatPhoneNumber(number) {
    let num = String(number).trim().replace(/[^\d+]/g, '')
    if (!num.startsWith('+')) num = '+' + num
    if (num.startsWith('+52')) {
        const digits = num.substring(3).replace(/\D/g, '')
        if (digits.length === 10) return digits.startsWith('1') ? '+52' + digits : '+521' + digits
        if (num.startsWith('+521') && num.length === 13) return num
    }
    return num
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('sessions')
    const { version } = await fetchLatestBaileysVersion()
    
    let opcion
    let phoneNumber = ""

    if (!fs.existsSync(`./sessions/creds.json`)) {
        do {
            console.log('')
            console.log(chalk.cyan('   -------------------------------'))
            console.log(chalk.cyan('   BASE DE BOT - CORVETTE SCRIPT'))
            console.log(chalk.cyan('   -------------------------------'))
            console.log(chalk.white('   METODO DE CONEXION'))
            console.log(chalk.white('   1) Usar codigo QR'))
            console.log(chalk.white('   2) Usar codigo de 8 digitos'))
            console.log(chalk.cyan('   -------------------------------'))
            process.stdout.write(chalk.white('   Selecciona opcion (1/2): '))
            opcion = await question('')
        } while (opcion !== '1' && opcion !== '2')
    }

    console.info = () => {}

    const conn = makeWASocket({
        version,
        logger: P({ level: 'silent' }),
        printQRInTerminal: opcion === '1',
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
        do {
            console.log(chalk.cyan('\n   INGRESA TU NUMERO DE WHATSAPP'))
            process.stdout.write(chalk.white('   Numero: '))
            phoneNumber = await question('')
            phoneNumber = String(phoneNumber).replace(/\D/g, '')
            if (!phoneNumber.startsWith('+')) phoneNumber = `+${phoneNumber}`
        } while (!await isValidPhoneNumber(phoneNumber))
        let addNumber = phoneNumber.replace(/\D/g, '')
        setTimeout(async () => {
            let codeBot = await conn.requestPairingCode(addNumber)
            codeBot = codeBot.match(/.{1,4}/g)?.join("-") || codeBot
            console.log(chalk.cyan('\n   CODIGO: ' + codeBot + '\n'))
        }, 1000)
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
                            const video_id = getVideoId(input_text)
                            const query = video_id ? `https://youtu.be/${video_id}` : input_text

                            let url = query
                            let title = 'audio'
                            let thumbnail = null

                            try {
                                const video_info = await getVideoInfo(query, video_id)
                                if (video_info) {
                                    url = video_info.url || `https://youtu.be/${video_info.videoId}`
                                    title = video_info.title || title
                                    thumbnail = video_info.image || video_info.thumbnail || null

                                    const views = Number(video_info.views || 0).toLocaleString('es-HN')
                                    const channel = video_info.author?.name || video_info.author || 'Desconocido'

                                    const info_message = `➩ Descargando › *${title}*

> ❖ Canal › *${channel}*
> ⴵ Duración › *${video_info.timestamp || 'Desconocido'}*
> ❒ Enlace › *${url}*`

                                    if (thumbnail) {
                                        await conn.sendMessage(from, { image: { url: thumbnail }, caption: info_message }, { quoted: msg })
                                    } else {
                                        await conn.sendMessage(from, { text: info_message }, { quoted: msg })
                                    }
                                }
                            } catch {}

                            if (!isYTUrl(url)) return reply('No se encontró un video válido.')
                            const audio = await getAudioFromYoutubei(url)
                            if (!audio?.buffer?.length) return reply('Error al descargar.')

                            await conn.sendMessage(from, {
                                audio: audio.buffer,
                                fileName: audio.name || `${sanitizeFileName(title)}.mp3`,
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
            console.log(chalk.cyan(`\n    ${global.botName.toUpperCase()} CONECTADO AL 100%\n`))
        }
        if (u.connection === 'close' && new Boom(u.lastDisconnect?.error)?.output.statusCode !== DisconnectReason.loggedOut) {
            startBot()
        }
    })
}

startBot()

// ==========================================
// FUNCIONES SECUNDARIAS YOUTUBE
// ==========================================
const youtubei = {
  endpoint: 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
  visitor_id: 'Cgs4ZmxfcDk4Vnk0VSjLvdrQBjIKCgJJRBIEGgAgXmLfAgrcAjE4LllUPWNsWWh5eHVVeE04N1AzV0tnZzZJeFpkV3lGOEVRNnJaei1DQ3hRTkdHV1NFcjg1MmpVQmZ6UzMtOE5zTVVSZ3EzbHFXUHFRZERyV0M3a2g2TlFEdUZybmJRbjkyc1JGVGxVd3MyZG5RMmFmVG95TlJnTXJReTdMNlRTOEVqcTFhaW5OQnJhOU9uRnJRa01IOGpVTzdiR3UwQVpqdjI0UURqNkdmeE1VcWVZc184cGxfOUNNVExVRG9HQ09sa1NPOUVHZG5CcWdUVzVRZ080OGRyQWxDeVRHUF9MRnhBNjVYZVVRR1FBeGxmU0ZSckhhRHI0cDROLWV2cmp0VDdEc3pKU3Q1clhSYkNmWWQ0YjJqbFN5NVh0ejMyajk5NWdkSGhLU1htcTcydHNGeDNUOW5xZXQ3UlZvV2JNbmNGWDBKTldqbXZyQzg0VHhqY1hCVFlnQ2dLQQ==',
  client_name: 'ANDROID_VR', client_version: '1.65.10', itag: 18
}
const ffmpeg_config = { path: 'ffmpeg', bitrate: '128k', sample_rate: '44100' }
const defaults = { user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
const isYTUrl = (url = '') => /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/i.test(url)
const getVideoId = (text = '') => {
  const raw = String(text || '').trim()
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw
  const patterns = [/youtu\.be\/([a-zA-Z0-9_-]{11})/, /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/]
  for (const pattern of patterns) { const match = raw.match(pattern); if (match?.[1]) return match[1] }
  return null
}
const sanitizeFileName = (name = 'audio') => cleanExtension(name).replace(/[\\/:*?"<>|]/g, '').slice(0, 120) || 'audio'
function cleanExtension(name = 'audio') { return String(name || 'audio').replace(/\.(mp3|m4a|mp4)$/i, '') }
async function getVideoInfo(input, video_id) {
  if (video_id) { try { const info = await yts({ videoId: video_id }); if (info?.videoId) return { ...info, url: `https://youtu.be/${info.videoId}` } } catch {} }
  const search = await yts(input); return search.videos?.[0] || null
}
async function getAudioFromYoutubei(url) {
  const video_id = getVideoId(url); if (!video_id) throw new Error('ID Inválido')
  const stream = await getYoutubeiStream(video_id); const buffer = await convertStreamUrlToMp3Buffer(stream.url)
  return { buffer, name: `${sanitizeFileName(stream.title || video_id)}.mp3`, title: stream.title }
}
async function getYoutubeiStream(video_id) {
  const response = await fetch(youtubei.endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-Goog-Visitor-Id': youtubei.visitor_id },
    body: JSON.stringify({ context: { client: { clientName: youtubei.client_name, clientVersion: youtubei.client_version } }, videoId: video_id })
  })
  const json = await response.json()
  const stream = json?.streamingData?.formats?.find(item => Number(item?.itag) === youtubei.itag && item?.url)
  if (!stream?.url) throw new Error('No stream URL')
  return { url: stream.url, title: json?.videoDetails?.title || video_id }
}
async function convertStreamUrlToMp3Buffer(url) {
  const response = await fetch(url, { headers: { 'user-agent': defaults.user_agent } })
  const input_stream = Readable.fromWeb(response.body)
  return await streamToMp3Buffer(input_stream)
}
function streamToMp3Buffer(input_stream) {
  return new Promise((resolve, reject) => {
    const chunks = []; const errors = []
    const ffmpeg = spawn(ffmpeg_config.path, ['-i', 'pipe:0', '-vn', '-acodec', 'libmp3lame', '-b:a', ffmpeg_config.bitrate, '-f', 'mp3', 'pipe:1'])
    ffmpeg.stdout.on('data', chunk => chunks.push(chunk))
    ffmpeg.stderr.on('data', chunk => errors.push(chunk))
    ffmpeg.on('close', code => {
      if (code !== 0) return reject(new Error('FFmpeg error'))
      resolve(Buffer.concat(chunks))
    })
    input_stream.pipe(ffmpeg.stdin)
  })
}
