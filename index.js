import './config.js'
import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys'
import P from 'pino'
import chalk from 'chalk'
import { Boom } from '@hapi/boom'
import fs from 'fs'
import yts from 'yt-search'
import fetch from 'node-fetch'
import { exec } from 'child_process'
import { promisify } from 'util'

const execPromise = promisify(exec)

const decodeJid = (jid) => {
    if (!jid) return jid
    if (/:\d+@/gi.test(jid)) {
        let decode = jid.match(/:(\d+)@/gi) || []
        return jid.replace(decode[0], '@')
    }
    return jid
}

// ==========================================
// FUNCIÓN DE VALIDACIÓN UNIVERSAL DE NÚMEROS
// ==========================================
async function isValidPhoneNumber(number) {
    try {
        let num = String(number).trim().replace(/[\s\-()+]/g, '')
        const isNumeric = /^\d+$/.test(num)
        const isLengthValid = num.length >= 7 && num.length <= 15
        return isNumeric && isLengthValid
    } catch (error) {
        return false
    }
}

const getVideoId = url => {
    const match = url.match(/(?:v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]{11})/)
    if (!match) throw new Error('No se pudo extraer el videoId')
    return match[1]
}

// ==========================================
// MOTOR DE DESCARGA OPTIMIZADO PARA APIS (RAILWAY)
// ==========================================
async function descargarYT(youtubeUrl, formato = 'mp3') {
    const id = getVideoId(youtubeUrl)
    const urlCompleta = `https://www.youtube.com/watch?v=${id}`
    
    if (formato === 'mp3') {
        try {
            const res = await fetch(`https://api.vreden.web.id/api/ytmp3?url=${urlCompleta}`)
            const json = await res.json()
            if (json.status === 200 && json.result?.downloadUrl) return { tipo: 'url', stream: json.result.downloadUrl }
        } catch (e) {
            console.log(chalk.yellow('[API Audio Principal falló, intentando alternativa...]'))
        }
        
        // Intento con comando local por si Railway tiene instalado yt-dlp
        try {
            const output = `./${id}.mp3`
            await execPromise(`yt-dlp -x --audio-format mp3 -o "${output}" "${urlCompleta}"`)
            return { tipo: 'local', stream: output }
        } catch (err) {
            throw new Error('No se pudo descargar el audio. Todas las vías fallaron.')
        }

    } else {
        try {
            const res = await fetch(`https://api.vreden.web.id/api/ytmp4?url=${urlCompleta}`)
            const json = await res.json()
            if (json.status === 200 && json.result?.downloadUrl) return { tipo: 'url', stream: json.result.downloadUrl }
        } catch (e) {
            console.log(chalk.yellow('[API Video Principal falló, intentando alternativa...]'))
        }
        
        try {
            const output = `./${id}.mp4`
            await execPromise(`yt-dlp -f "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]" --merge-output-format mp4 -o "${output}" "${urlCompleta}"`)
            return { tipo: 'local', stream: output }
        } catch (err) {
            throw new Error('No se pudo descargar el video. Todas las vías fallaron.')
        }
    }
}

// ==========================================
// FUNCIÓN PRINCIPAL DEL BOT
// ==========================================
async function startBot() {
    const authFolder = 'sessions'
    const { state, saveCreds } = await useMultiFileAuthState(authFolder)
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
        browser: ["Ubuntu", "Chrome", "125.0.0.0"],
        syncFullHistory: false,
        markOnlineOnConnect: true
    })
    
    conn.ev.on('creds.update', saveCreds)

    // OBTENCIÓN AUTOMÁTICA DEL NÚMERO EN RAILWAY
    if (!fs.existsSync(`./${authFolder}/creds.json`) && !conn.authState.creds.registered) {
        // Busca el número en tus variables de Railway (NUMERO) o usa el del Owner en config.js
        let phoneNumber = process.env.NUMERO || global.owner?.[0]?.[0] || ''
        phoneNumber = phoneNumber.replace(/[\s\-()+]/g, '')

        if (await isValidPhoneNumber(phoneNumber)) {
            console.log(chalk.cyan('\n======================================'))
            console.log(chalk.cyan('   GENERANDO CÓDIGO DE VINCULACIÓN'))
            console.log(chalk.cyan(`   Número detectado: +${phoneNumber}`))
            console.log(chalk.cyan('======================================\n'))

            setTimeout(async () => {
                try {
                    let codeBot = await conn.requestPairingCode(phoneNumber)
                    codeBot = codeBot.match(/.{1,4}/g)?.join("-") || codeBot
                    console.log(chalk.green('\n======================================'))
                    console.log(chalk.green('🔑 TU CÓDIGO DE VINCULACIÓN EN RAILWAY ES:'))
                    console.log(chalk.white(`👉   ${codeBot}   👈`))
                    console.log(chalk.green('======================================\n'))
                } catch (err) {
                    console.error(chalk.red('❌ Error al solicitar código en Railway:'), err)
                }
            }, 3000)
        } else {
            console.log(chalk.red('\n[!] Error: No se configuró un número válido en Railway.'))
            console.log(chalk.yellow('Asegúrate de crear una variable de entorno llamada NUMERO con tu número de WhatsApp (ej: 50688888888).\n'))
            process.exit(1)
        }
    }

    // ==========================================
    // ESCUCHADOR DE MENSAJES Y COMANDOS
    // ==========================================
    conn.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0]
            if (!msg || !msg.message) return

            const from = msg.key.remoteJid
            const sender = msg.key.participant || msg.key.remoteJid
            const pushName = msg.pushName || 'Usuario'
            const type = Object.keys(msg.message)[0]
            
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
                            text: `*ESTADO DEL BOT (RAILWAY)*\n\n• Uptime: ${h}h ${m}m ${s}s\n• RAM: ${ram} MB\n• Node.js: ${process.version}\n• Owner: ${global.dev}` 
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
                            if (!from.endsWith('@g.us')) return reply('「✎」 Este comando solo funciona en grupos.')

                            const groupMetadata = await conn.groupMetadata(from)
                            const participants = groupMetadata.participants
                            const senderNumber = sender.replace(/\D/g, '')
                            const botNumber = String(conn.user?.id || '').replace(/\D/g, '')
                            const ownerNumberConfig = String(global.owner?.[0]?.[0] || '').replace(/\D/g, '')
                            const isUserAdmin = participants.find(p => p.id === sender)?.admin !== null
                            const isOwner = senderNumber === botNumber || senderNumber === ownerNumberConfig || pushName === global.dev

                            if (!isUserAdmin && !isOwner) return reply('「✎」 Este comando es solo para Administradores.')

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
                                    if (quotedType === 'conversation') contentToForward.conversation = `${customText}\n\n${contentToForward.conversation}`
                                    else if (quotedType === 'extendedTextMessage') contentToForward.extendedTextMessage.text = `${customText}\n\n${contentToForward.extendedTextMessage.text}`
                                    else if (contentToForward[quotedType] && 'caption' in contentToForward[quotedType]) contentToForward[quotedType].caption = `${customText}\n\n${contentToForward[quotedType].caption || ''}`
                                }
                                return await conn.sendMessage(from, contentToForward)
                            }

                            let textMessage = args.join(' ').trim()
                            if (!textMessage) return reply(`「✎」 Uso correcto:\n\n> *${usedPrefix + command}* mensaje`)

                            await conn.sendMessage(from, { text: textMessage, mentions: targetParticipants }, { quoted: msg })
                        } catch (e) { reply(`[Error]: ${e.message}`) }
                        break

                    case 'play':
                    case 'mp3':
                        try {
                            if (!args[0]) return reply('《✧》Por favor, menciona el nombre o URL de la música.')
                            const input_text = args.join(' ').trim()
                            
                            let videoUrl = ''
                            let videoTitle = 'Audio'
                            let videoImage = global.banner

                            if (input_text.includes('youtube.com') || input_text.includes('youtu.be')) {
                                videoUrl = input_text
                            } else {
                                const search = await yts(input_text).catch(() => null)
                                const video = search?.videos?.[0]
                                if (!video) return reply('❌ Error: No se pudo obtener el token de YouTube. Intenta de nuevo usando un enlace directo.')
                                videoUrl = video.url
                                videoTitle = video.title
                                videoImage = video.image
                            }

                            await conn.sendMessage(from, { image: { url: videoImage }, caption: `➩ Descargando Audio › *${videoTitle}*` }, { quoted: msg })
                            
                            const resultado = await descargarYT(videoUrl, 'mp3')
                            const configAudio = {
                                audio: resultado.tipo === 'url' ? { url: resultado.stream } : fs.readFileSync(resultado.stream),
                                fileName: `${videoTitle}.mp3`,
                                mimetype: 'audio/mpeg'
                            }
                            
                            await conn.sendMessage(from, configAudio, { quoted: msg })
                            if (resultado.tipo === 'local') fs.unlinkSync(resultado.stream)

                        } catch (e) { 
                            reply(`[Error]: ${e.message}\n\n💡 Consejo: Si la búsqueda falla por restricciones de YouTube, pásame el enlace directo del video.`) 
                        }
                        break

                    case 'play2':
                    case 'mp4':
                        try {
                            if (!args[0]) return reply('《✧》Por favor, menciona el nombre o URL del video.')
                            const input_text = args.join(' ').trim()
                            
                            let videoUrl = ''
                            let videoTitle = 'Video'
                            let videoImage = global.banner

                            if (input_text.includes('youtube.com') || input_text.includes('youtu.be')) {
                                videoUrl = input_text
                            } else {
                                const search = await yts(input_text).catch(() => null)
                                const video = search?.videos?.[0]
                                if (!video) return reply('❌ Error: No se pudo obtener el token de YouTube. Intenta de nuevo usando un enlace directo.')
                                videoUrl = video.url
                                videoTitle = video.title
                                videoImage = video.image
                            }

                            await conn.sendMessage(from, { image: { url: videoImage }, caption: `➩ Descargando Video › *${videoTitle}*` }, { quoted: msg })
                            
                            const resultado = await descargarYT(videoUrl, 'mp4')
                            const configVideo = {
                                video: resultado.tipo === 'url' ? { url: resultado.stream } : fs.readFileSync(resultado.stream),
                                fileName: `${videoTitle}.mp4`,
                                mimetype: 'video/mp4'
                            }
                            
                            await conn.sendMessage(from, configVideo, { quoted: msg })
                            if (resultado.tipo === 'local') fs.unlinkSync(resultado.stream)

                        } catch (e) { 
                            reply(`[Error]: ${e.message}\n\n💡 Consejo: Si la búsqueda falla por restricciones de YouTube, pásame el enlace directo del video.`) 
                        }
                        break
                        
                    default:
                        if (body.startsWith(usedPrefix)) reply(`Comando no encontrado: *${command}*`)
                        break
                }
            }
        } catch (err) { console.error(err) }
    })

    // ==========================================
    // CONTROL DE CONEXIÓN Y RECONEXIONES
    // ==========================================
    conn.ev.on('connection.update', (u) => {
        if (u.connection === 'open') {
            console.log(chalk.cyan('\n   ---------------------------------------\n    BOT DE RAILWAY INICIADO CORRECTAMENTE\n   ---------------------------------------'))
        }
        if (u.connection === 'close') {
            const reason = new Boom(u.lastDisconnect?.error)?.output.statusCode
            if (reason !== DisconnectReason.loggedOut) {
                console.log(chalk.yellow('🔄 Conexión interrumpida en Railway. Reconectando...'))
                startBot()
            } else {
                console.log(chalk.red('❌ Sesión cerrada de WhatsApp. Eliminando archivos corruptos en Railway...'))
                if (fs.existsSync(authFolder)) fs.rmSync(authFolder, { recursive: true, force: true })
                process.exit(0)
            }
        }
    })
}

startBot().catch(err => console.error('Fallo crítico al arrancar en Railway:', err))
