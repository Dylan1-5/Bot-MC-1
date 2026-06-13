import './config.js'
import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys'
import P from 'pino'
import chalk from 'chalk'
import { Boom } from '@hapi/boom'
import fs, { existsSync } from 'fs'
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import readline from 'readline'

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
● ${usedPrefix}owner
● ${usedPrefix}status

――――――――――――――――――――

Base: *Corvette Script*
GitHub: *github.com/ScriptGray*`
                        
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

――――――――――――――――――――

Base desarrollada por:
Corvette Script
GitHub: github.com/ScriptGray` 
                        }, { quoted: msg })
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