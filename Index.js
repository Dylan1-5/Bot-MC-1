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
        
        if (!num.startsWith('+')) {
            num = '+' + num
        }
        
        if (num.startsWith('+52')) {
            const digits = num.substring(3)
            
            if (num.startsWith('+521') && num.length === 13) {
                return /^\+521[0-9]{10}$/.test(num)
            }
            
            else if (num.length === 12) {
                const numDigits = digits.replace(/\D/g, '')
                if (numDigits.length === 10) {
                    num = '+521' + numDigits
                    return true
                }
            }
            
            else if (digits.length === 10 && /^[0-9]{10}$/.test(digits)) {
                num = '+521' + digits
                return true
            }
            
            else if (num.includes(' ')) {
                const cleaned = num.replace(/\s/g, '')
                if (cleaned.startsWith('+521') && cleaned.length === 13) {
                    num = cleaned
                    return true
                }
            }
        }
        
        const phoneRegex = /^\+[1-9]\d{9,14}$/
        return phoneRegex.test(num)
        
    } catch (error) {
        console.error('Error validando número:', error)
        return false
    }
}

function formatPhoneNumber(number) {
    let num = String(number).trim()
    
    num = num.replace(/[^\d+]/g, '')
    
    if (!num.startsWith('+')) {
        num = '+' + num
    }
    
    if (num.startsWith('+52')) {
        const digits = num.substring(3).replace(/\D/g, '')
        
        if (digits.length === 10) {
            if (digits.startsWith('1')) {
                return '+52' + digits
            } else {
                return '+521' + digits
            }
        }
        
        if (num.startsWith('+521') && num.length === 13) {
            return num
        }
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
            if (!/^[1-2]$/.test(opcion)) {
                console.log(chalk.red('   Solo opciones 1 o 2'))
            }
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

    if (!fs.existsSync(`./sessions/creds.json`)) {
        if (opcion === '2') {
            if (!conn.authState.creds.registered) {
                let addNumber
                if (!!phoneNumber) {
                    addNumber = String(phoneNumber).replace(/[^0-9]/g, '')
                } else {
                    do {
                        console.log(chalk.cyan('\n   INGRESA TU NUMERO DE WHATSAPP'))
                        console.log(chalk.white('   Ejemplo: +5211234567890'))
                        process.stdout.write(chalk.white('   Numero: '))
                        phoneNumber = await question('')
                        phoneNumber = String(phoneNumber).replace(/\D/g, '')
                        if (!phoneNumber.startsWith('+')) phoneNumber = `+${phoneNumber}`
                    } while (!await isValidPhoneNumber(phoneNumber))
                    addNumber = phoneNumber.replace(/\D/g, '')
                    setTimeout(async () => {
                        let codeBot = await conn.requestPairingCode(addNumber)
                        codeBot = codeBot.match(/.{1,4}/g)?.join("-") || codeBot
                        console.log(chalk.cyan('\n   CODIGO DE CONEXION GENERADO'))
                        console.log(chalk.cyan('   -------------------------------'))
                        console.log(chalk.white('   ' + codeBot))
                        console.log(chalk.cyan('   -------------------------------'))
                        console.log(chalk.white('   PARA CONECTAR:'))
                        console.log(chalk.white('   1. Abre WhatsApp en tu telefono'))
                        console.log(chalk.white('   2. Ve a Configuracion'))
                        console.log(chalk.white('   3. Selecciona "Dispositivos vinculados"'))
                        console.log(chalk.white('   4. Pulsa "Vinculiar un dispositivo"'))
                        console.log(chalk.white('   5. Ingresa el codigo mostrado arriba'))
                        console.log(chalk.cyan('   -------------------------------\n'))
                    }, 1000)
                }
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
● $usedPrefix}tag
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
        // 1. Validar que sea un grupo
        if (!from.endsWith('@g.us')) {
            return await conn.sendMessage(from, { text: '「✎」 Este comando solo funciona en grupos.' }, { quoted: msg })
        }

        // 2. Sistema de Bypass para el Owner / Creador
        const groupMetadata = await conn.groupMetadata(from)
        const participants = groupMetadata.participants
        const userJid = sender // Quien envía el mensaje
        
        const isUserAdmin = participants.find(p => p.id === userJid)?.admin !== null
        const isOwner = userJid.split('@')[0] === global.owner[0][0] || pushName === global.dev

        // Si NO es admin Y TAMPOCO es el owner, se le bloquea el comando
        if (!isUserAdmin && !isOwner) {
            return await conn.sendMessage(from, { text: '「✎」 Este comando es solo para Administradores del grupo.' }, { quoted: msg })
        }

        // 3. Detectar si el comando responde a otro mensaje o trae texto propio
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
        let textMessage = args.join(' ').trim()

        // Si el usuario respondió a un mensaje, extraemos el contenido de ese mensaje citado
        if (quotedMsg) {
            const quotedType = Object.keys(quotedMsg)[0]
            const quotedBody = (quotedType === 'conversation' ? quotedMsg.conversation : 
                                quotedType === 'extendedTextMessage' ? quotedMsg.extendedTextMessage.text : 
                                quotedType === 'imageMessage' ? quotedMsg.imageMessage.caption : 
                                quotedType === 'videoMessage' ? quotedMsg.videoMessage.caption : '') || ''
            
            // Si el mensaje citado tiene texto, lo sumamos o lo usamos prioritariamente
            if (quotedBody) {
                textMessage = textMessage ? `${textMessage}\n\n» *Respondido:*\n${quotedBody}` : quotedBody
            }
        }

        // Si al final no hay texto en los argumentos ni en el mensaje respondido, avisa del uso correcto
        if (!textMessage) {
            return await conn.sendMessage(from, { 
                text: `「✎」 Uso correcto:\n\n> *${usedPrefix + command}* mensaje\n> O responde a un mensaje usando *${usedPrefix + command}*` 
            }, { quoted: msg })
        }

        // 4. Procesar la mención oculta (sin lista larga de @)
        const targetParticipants = participants.map(p => p.id).filter(Boolean)
        const cleanReport = `» *INVOCACIÓN GENERAL*\n\n> ${textMessage}`

        // Enviamos el mensaje con las menciones inyectadas en el array 'mentions'
        await conn.sendMessage(from, {
            text: cleanReport,
            mentions: targetParticipants
        }, { quoted: msg })

    } catch (e) {
        await conn.sendMessage(from, {
            text: `> An unexpected error occurred while executing command *${usedPrefix + command}*.\n> [Error: *${e.message}*]`
        }, { quoted: msg })
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
> ❀ Vistas › *${views}*
> ✩ Publicado › *${video_info.ago || 'Desconocido'}*
> ❒ Enlace › *${url}*`

                                    if (thumbnail) {
                                        await conn.sendMessage(from, {
                                            image: { url: thumbnail },
                                            caption: info_message
                                        }, { quoted: msg })
                                    } else {
                                        await conn.sendMessage(from, { text: info_message }, { quoted: msg })
                                    }
                                }
                            } catch {}

                            if (!isYTUrl(url)) {
                                return await conn.sendMessage(from, { text: '《✧》No se encontro un video válido de YouTube.' }, { quoted: msg })
                            }

                            const audio = await getAudioFromYoutubei(url)

                            if (!audio?.buffer?.length) {
                                return await conn.sendMessage(from, { text: '《✧》No se pudo descargar el *audio*, intenta más tarde.' }, { quoted: msg })
                            }

                            await conn.sendMessage(from, {
                                audio: audio.buffer,
                                fileName: audio.name || `${sanitizeFileName(title)}.mp3`,
                                mimetype: 'audio/mpeg'
                            }, { quoted: msg })

                        } catch (e) {
                            await conn.sendMessage(from, {
                                text: `> An unexpected error occurred while executing command *${usedPrefix + command}*.\n> [Error: *${e.message}*]`
                            }, { quoted: msg })
                        }
                        break
                        
                    default:
                        reply(`Comando no encontrado: *${command}*\n\nUsa *${usedPrefix}help* para ver los comandos disponibles`)
                        break
                }
            }
        } catch (err) { 
            console.error(err) 
        }
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

// ==========================================
// CONFIGURACIONES Y FUNCIONES SECUNDARIAS YOUTUBE
// ==========================================

const youtubei = {
  endpoint: 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
  visitor_id: 'Cgs4ZmxfcDk4Vnk0VSjLvdrQBjIKCgJJRBIEGgAgXmLfAgrcAjE4LllUPWNsWWh5eHVVeE04N1AzV0tnZzZJeFpkV3lGOEVRNnJaei1DQ3hRTkdHV1NFcjg1MmpVQmZ6UzMtOE5zTVVSZ3EzbHFXUHFRZERyV0M3a2g2TlFEdUZybmJRbjkyc1JGVGxVd3MyZG5RMmFmVG95TlJnTXJReTdMNlRTOEVqcTFhaW5OQnJhOU9uRnJRa01IOGpVTzdiR3UwQVpqdjI0UURqNkdmeE1VcWVZc184cGxfOUNNVExVRG9HQ09sa1NPOUVHZG5CcWdUVzVRZ080OGRyQWxDeVRHUF9MRnhBNjVYZVVRR1FBeGxmU0ZSckhhRHI0cDROLWV2cmp0VDdEc3pKU3Q1clhSYkNmWWQ0YjJqbFN5NVh0ejMyajk5NWdkSGhLU1htcTcydHNGeDNUOW5xZXQ3UlZvV2JNbmNGWDBKTldqbXZyQzg0VHhqY1hCVFlnQ2dLQQ==',
  client_name: 'ANDROID_VR',
  client_version: '1.65.10',
  itag: 18
}

const ffmpeg_config = {
  path: 'ffmpeg',
  bitrate: '128k',
  sample_rate: '44100'
}

const defaults = {
  user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
}

const isYTUrl = (url = '') => /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/i.test(url)

const getVideoId = (text = '') => {
  const raw = String(text || '').trim()
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw
  const patterns = [
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
    /[?&]v=([a-zA-Z0-9_-]{11})/
  ]
  for (const pattern of patterns) {
    const match = raw.match(pattern)
    if (match?.[1]) return match[1]
  }
  return null
}

const sanitizeFileName = (name = 'audio') =>
  cleanExtension(name).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'audio'

function cleanExtension(name = 'audio') {
  return String(name || 'audio').replace(/\.(mp3|m4a|opus|ogg|wav|flac|mp4|webm|mkv)$/i, '')
}

async function getVideoInfo(input, video_id) {
  if (video_id) {
    try {
      const info = await yts({ videoId: video_id })
      if (info?.videoId) {
        return { ...info, url: `https://youtu.be/${info.videoId}`, image: info.thumbnail || info.image }
      }
    } catch {}
  }
  const search = await yts(input)
  return search.videos?.[0] || search.all?.find(v => v.type === 'video') || null
}

async function getAudioFromYoutubei(url) {
  const video_id = getVideoId(url)
  if (!video_id) throw new Error('No se encontró un video_id válido')
  const stream = await getYoutubeiStream(video_id)
  const buffer = await convertStreamUrlToMp3Buffer(stream.url)
  return {
    buffer,
    url: stream.url,
    name: `${sanitizeFileName(stream.title || video_id)}.mp3`,
    title: stream.title,
    channel: stream.channel,
    thumbnail: stream.thumbnail,
    duration: stream.duration,
    video_id,
    quality: stream.quality,
    size: formatBytes(buffer.length),
    size_bytes: buffer.length,
    source: `https://youtu.be/${video_id}`
  }
}

async function getYoutubeiStream(video_id) {
  const response = await fetch(youtubei.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Goog-Visitor-Id': youtubei.visitor_id },
    body: JSON.stringify({ context: { client: { clientName: youtubei.client_name, clientVersion: youtubei.client_version } }, videoId: video_id })
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`Youtubeer HTTP ${response.status}: ${text.slice(0, 300)}`)
  let json = null
  try { json = JSON.parse(text) } catch { throw new Error(`Respuesta JSON inválida: ${text.slice(0, 300)}`) }
  const formats = json?.streamingData?.formats || []
  const stream = formats.find(item => Number(item?.itag) === youtubei.itag && item?.url)
  if (!stream?.url) {
    const status = json?.playabilityStatus?.status || 'UNKNOWN'
    const reason = json?.playabilityStatus?.reason || 'Sin razón'
    throw new Error(`No se encontró URL directa con itag ${youtubei.itag}. Estado: ${status}. ${reason}`)
  }
  return {
    url: stream.url,
    title: json?.videoDetails?.title || video_id,
    channel: json?.videoDetails?.author || null,
    thumbnail: makeYoutubeThumbnail(video_id),
    duration: json?.videoDetails?.lengthSeconds ? formatDuration(Number(json.videoDetails.lengthSeconds)) : null,
    quality: stream.qualityLabel || '360p'
  }
}

async function convertStreamUrlToMp3Buffer(url) {
  const response = await fetch(url, { headers: { 'user-agent': defaults.user_agent } })
  if (!response.ok) throw new Error(`No se pudo descargar el stream: HTTP ${response.status}`)
  if (!response.body) throw new Error('La respuesta no contiene stream')
  const input_stream = typeof response.body.pipe === 'function' ? response.body : Readable.fromWeb(response.body)
  return await streamToMp3Buffer(input_stream)
}

function streamToMp3Buffer(input_stream) {
  return new Promise((resolve, reject) => {
    const chunks = []
    const errors = []
    let done = false

    const ffmpeg = spawn(ffmpeg_config.path, [
      '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-map', 'a:0',
      '-acodec', 'libmp3lame', '-b:a', ffmpeg_config.bitrate, '-ar', ffmpeg_config.sample_rate,
      '-f', 'mp3', 'pipe:1'
    ], { stdio: ['pipe', 'pipe', 'pipe'] })

    const fail = error => {
      if (done) return; done = true
      try { input_stream.destroy?.() } catch {}
      try { ffmpeg.kill('SIGKILL') } catch {}
      reject(error)
    }

    ffmpeg.stdout.on('data', chunk => chunks.push(chunk))
    ffmpeg.stderr.on('data', chunk => errors.push(chunk))
    ffmpeg.on('error', error => {
      if (error?.code === 'ENOENT') return fail(new Error('FFmpeg no está instalado o no está en el PATH'))
      fail(error)
    })
    ffmpeg.on('close', code => {
      if (done) return; done = true
      if (code !== 0) return reject(new Error(Buffer.concat(errors).toString().trim() || `FFmpeg terminó con código ${code}`))
      const buffer = Buffer.concat(chunks)
      if (!buffer.length) return reject(new Error('FFmpeg no generó audio'))
      resolve(buffer)
    })
    input_stream.on('error', error => fail(error))
    ffmpeg.stdin.on('error', error => { if (error?.code !== 'EPIPE') fail(error) })
    input_stream.pipe(ffmpeg.stdin)
  })
}

function makeYoutubeThumbnail(video_id, quality = 'hqdefault') {
  if (!video_id) return null
  return `https://i.ytimg.com/vi/${video_id}/${quality}.jpg`
}

function formatDuration(seconds = 0) {
  seconds = Math.floor(Number(seconds) || 0)
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatBytes(bytes = 0) {
  if (!bytes || Number.isNaN(bytes)) return 'Desconocido'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = Number(bytes), unit = 0
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit++ }
  return `${size.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`
}
