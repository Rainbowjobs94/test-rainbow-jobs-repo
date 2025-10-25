import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import Stripe from 'stripe'
import pkg from 'pg'
const { Pool } = pkg

const app = express()
app.use(express.json({ verify:(req,res,buf)=>{ req.rawBody = buf } }))
app.use(cors())
app.use(helmet())
app.use(rateLimit({ windowMs: 15*60*1000, max: 200 }))

const stripe = new Stripe(process.env.STRIPE_SECRET || '', { apiVersion: '2024-06-20' })
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const DAILY_CAP = Number(process.env.DAILY_CAP_USD || 2000)
const MONTHLY_CAP = Number(process.env.MONTHLY_CAP_USD || 10000)
const blockedCountries = (process.env.OFAC_BLOCKLIST || 'CU,IR,KP,SY,UA-43,UA-14,RU').split(',')

app.get('/api/health', (req,res)=> res.json({ ok:true }))

app.post('/api/kyc/start', async (req,res)=>{
  const { email } = req.body || {}
  if(!email) return res.status(400).json({ error:'email required' })
  await pool.query(`insert into kyc_verifications(email,status) values($1,'pending')
                    on conflict(email) do update set status='pending', updated_at=now()`, [email])
  res.json({ status:'pending' })
})

async function capsOk(email, amt){
  const q = await pool.query(`select
    coalesce(sum(amount_usd) filter (where created_at >= now() - interval '1 day'),0) as day,
    coalesce(sum(amount_usd) filter (where created_at >= date_trunc('month', now())),0) as month
    from receipts where email=$1 and status='paid'`, [email])
  const d = Number(q.rows[0].day||0), m = Number(q.rows[0].month||0)
  if(d + amt > DAILY_CAP) return { ok:false, reason:'daily_cap' }
  if(m + amt > MONTHLY_CAP) return { ok:false, reason:'monthly_cap' }
  return { ok:true }
}

app.post('/api/checkout', async (req,res)=>{
  try{
    const country = (req.headers['cf-ipcountry'] || req.headers['x-country'] || '').toUpperCase()
    if(country && blockedCountries.includes(country)) return res.status(451).json({ error:'region_blocked' })
    const { amountUSD, email } = req.body || {}
    if(!amountUSD || !email) return res.status(400).json({ error:'amountUSD and email required' })

    const k = await pool.query('select status from kyc_verifications where email=$1', [email])
    if(!k.rowCount || k.rows[0].status !== 'approved') return res.status(403).json({ error:'kyc_required' })

    const ok = await capsOk(email, Number(amountUSD))
    if(!ok.ok) return res.status(429).json({ error: ok.reason })

    const session = await stripe.checkout.sessions.create({
      mode:'payment',
      line_items:[{
        price_data:{ currency:'usd', product_data:{ name:'Invest in MC (Demo)' }, unit_amount: Math.round(Number(amountUSD)*100) },
        quantity:1
      }],
      customer_email: email,
      success_url: process.env.POST_CHECKOUT_SUCCESS_URL || 'https://lovetranscendsreality.org/success',
      cancel_url: process.env.POST_CHECKOUT_CANCEL_URL || 'https://lovetranscendsreality.org/cancel',
      metadata:{ email, amountUSD }
    })
    res.json({ url: session.url })
  }catch(e){
    console.error(e)
    res.status(500).json({ error:'server_error' })
  }
})

app.post('/webhooks/stripe', (req,res)=>{
  try{
    const sig = req.headers['stripe-signature']
    const event = stripe.webhooks.constructEvent(req.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET)
    if(event.type==='checkout.session.completed'){
      const s = event.data.object
      const email = s.customer_details?.email || s.customer_email
      const amountUSD = Number(s.metadata?.amountUSD || (s.amount_total/100))
      pool.query(`insert into receipts(email,amount_usd,status,stripe_session_id) values($1,$2,'paid',$3)`, [email,amountUSD,s.id])
      pool.query(`insert into mints(email,amount_usd,status) values($1,$2,'queued')`, [email,amountUSD])
    }
    res.json({ received:true })
  }catch(e){
    console.error('Webhook error:', e.message)
    res.status(400).send(`Webhook Error: ${e.message}`)
  }
})

app.listen(process.env.PORT || 8080, ()=> console.log('SERVER listening on', process.env.PORT || 8080))
