import './config.js'
import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, makeCacheableSignalKeyStore, delay } from '@whiskeysockets/baileys'
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

// ==========================================
// CONFIGURACIÓN DINÁMICA DESDE VARIABLES
// ==========================================
const CONFIG = {
    ytApi: process.env.YT_API_URL || 'https://api.vreden.web.id',
    bannerEnabled: process.env.BANNER_ENABLED !== 'false', // Por defecto activado
    botName: process.env.BOT_NAME || global.botName || 'Bot-MC-1'
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
// MOTOR DE DESCARGA MULTI-API (RAILWAY)
// ==========================================
async function descargarYT(youtubeUrl, formato = 'mp3') {
    const id = getVideoId(youtubeUrl)
    const urlCompleta = `https://www.youtube.com/watch?v=${id}`
    const apiBase = CONFIG.ytApi.replace(/\/$/, '') // Limpia barras diagonales al final
    
    if (formato === 'mp3') {
        try {
            const res = await fetch(`${apiBase}/api/ytmp3?url=${urlCompleta}`)
            const json = await res.json()
            const link = json.result?.downloadUrl || json.data?.downloadUrl || json.result
            if (link) return link
        } catch (e) {
            console.log(chalk.yellow('[API Principal falló, intentando respaldo Agustina...]'))
        }
        
        try {
            const res = await fetch(`https://api.agatz.xyz/api/ytmp3?url=${urlCompleta}`)
            const json = await res.json()
            const link = json.data?.downloadUrl || json.result
            if (link) return link
        } catch (e) {
            throw new Error('Todas las APIs de audio fallaron.')
        }

    } else {
        try {
            const res = await fetch(`${apiBase}/api/ytmp4?url=${urlCompleta}`)
            const json = await res.json()
            const link = json.result?.downloadUrl || json.data?.downloadUrl || json.result
            if (link) return link
        } catch (e) {
            console.log(chalk.yellow('[API Principal falló, intentando respaldo...]'))
        }
        
        try {
            const res = await fetch(`https://api.agatz.xyz/api/ytmp4?url=${urlCompleta}`)
            const json = await res.json()
            const link = json.data?.downloadUrl || json.result
            if (link) return link
        } catch (e) {
            throw new Error('Todas las APIs de video fallaron.')
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

    // OBTENCIÓN AUTOMÁTICA DEL NÚMERO
    if (!fs.existsSync(`./${authFolder}/creds.json`) && !conn.authState.creds.registered) {
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
                
                // FUNCIÓN DE RESPUESTA CON SIMULACIÓN DE "ESCRIBIENDO..."
                const reply = async (text) => {
                    await conn.sendPresenceUpdate('composing', from)
                    await delay(1500)
                    await conn.sendPresenceUpdate('paused', from)
                    return conn.sendMessage(from, { text }, { quoted: msg })
                }
                
                switch (command) {
                    case 'menu':
                    case 'help':
                    case 'ayuda':
                        const menu = `¡Hola! *${pushName}*, soy *${CONFIG.botName}*

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
                        
                        await conn.sendPresenceUpdate('composing', from)
                        await delay(2000)
                        await conn.sendPresenceUpdate('paused', from)
                        
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
                        
                        await reply(`*ESTADO DEL BOT (RAILWAY)*\n\n• Uptime: ${h}h ${m}m ${s}s\n• RAM: ${ram} MB\n• Node.js: ${process.version}\n• Owner: ${global.dev}`)
                        break
                        
                    case 'ping':
                    case 'p':
                        const start = Date.now()
                        await conn.sendPresenceUpdate('composing', from)
                        await delay(500)
                        const { key } = await conn.sendMessage(from, { text: 'Calculando...' }, { quoted: msg })
                        await conn.sendMessage(from, { text: `PONG!\nLatencia: ${Date.now() - start}ms`, edit: key })
                        break
                        
                    case 'owner':
                    case 'creador':
                    case 'dueño':
                        const ownerNumber = global.owner[0][0]
                        const ownerName = global.dev
                        await reply(`INFORMACION OWNER\n\nNombre: ${ownerName}\nContacto: ${ownerNumber}\n\n――――――――――――――――――――`)
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

                            await conn.sendPresenceUpdate('composing', from)
                            await delay(1500)

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
                            
                            // OPCIONES CON USER-AGENT QUE SIMULAN UN NAVEGADOR HUMANO EN CR
                            const searchOptions = {
                                hl: 'es',
                                gl: 'CR',
                                headers: {
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                                    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
                                    'Referer': 'https://www.google.com/'
                                }
                            }

                            let search = await yts({ query: input_text, ...searchOptions }).catch(() => null)
                            let video = search?.videos?.[0]
                            if (!video) return reply('❌ No se encontraron resultados. Intenta de nuevo o prueba con un enlace directo.')

                            if (CONFIG.bannerEnabled) {
                                const captionInfo = `➩ *Descargando:*
${video.title}

│ ❖ *Canal:* ${video.author.name}
│ ⏳ *Duración:* ${video.timestamp}
│ ❀ *Vistas:* ${video.views.toLocaleString()}
│ ☆ *Publicado:* ${video.ago}
│ 🔗 *Enlace:* ${video.url}`

                                await conn.sendPresenceUpdate('composing', from)
                                await delay(1000)
                                await conn.sendMessage(from, { image: { url: video.image }, caption: captionInfo }, { quoted: msg })
                            }
                            
                            // SIMULACIÓN GRABANDO AUDIO
                            await conn.sendPresenceUpdate('recording', from)
                            
                            const downloadUrl = await descargarYT(video.url, 'mp3')
                            
                            await conn.sendMessage(from, {
                                audio: { url: downloadUrl },
                                fileName: `${video.title}.mp3`,
                                mimetype: 'audio/mpeg'
                            }, { quoted: msg })
                            
                            await conn.sendPresenceUpdate('paused', from)

                        } catch (e) { 
                            await conn.sendPresenceUpdate('paused', from)
                            reply(`[Error]: ${e.message}\n\n💡 Intenta de nuevo o prueba usando un enlace directo de YouTube.`) 
                        }
                        break

                    case 'play2':
                    case 'mp4':
                        try {
                            if (!args[0]) return reply('《✧》Por favor, menciona el nombre o URL del video.')
                            const input_text = args.join(' ').trim()
                            
                            const searchOptions = {
                                hl: 'es',
                                gl: 'CR',
                                headers: {
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                                    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
                                    'Referer': 'https://www.google.com/'
                                }
                            }

                            let search = await yts({ query: input_text, ...searchOptions }).catch(() => null)
                            let video = search?.videos?.[0]
                            if (!video) return reply('❌ No se encontraron resultados. Intenta de nuevo o prueba con un enlace directo.')

                            if (CONFIG.bannerEnabled) {
                                const captionInfo = `➩ *Descargando Video:*
${video.title}

│ ❖ *Canal:* ${video.author.name}
│ ⏳ *Duración:* ${video.timestamp}
│ ❀ *Vistas:* ${video.views.toLocaleString()}
│ ☆ *Publicado:* ${video.ago}
│ 🔗 *Enlace:* ${video.url}`

                                await conn.sendPresenceUpdate('composing', from)
                                await delay(1000)
                                await conn.sendMessage(from, { image: { url: video.image }, caption: captionInfo }, { quoted: msg })
                            }
                            
                            // SIMULACIÓN ESCRIBIENDO MIENTRAS ENVÍA VIDEO
                            await conn.sendPresenceUpdate('composing', from)
                            
                            const downloadUrl = await descargarYT(video.url, 'mp4')
                            
                            await conn.sendMessage(from, {
                                video: { url: downloadUrl },
                                fileName: `${video.title}.mp4`,
                                mimetype: 'video/mp4'
                            }, { quoted: msg })
                            
                            await conn.sendPresenceUpdate('paused', from)

                        } catch (e) { 
                            await conn.sendPresenceUpdate('paused', from)
                            reply(`[Error]: ${e.message}\n\n💡 Intenta de nuevo o prueba usando un enlace directo de YouTube.`) 
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
