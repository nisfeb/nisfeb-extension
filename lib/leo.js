//  What Brave Leo's "Bring your own model" form asks for, filled from the
//  ship's Armillary inference config, or why Leo cannot run on it. Talon's
//  armillary/BraveLeo.kt, as it is. An extension cannot fill the form
//  itself: Leo keeps its custom models in Brave's own profile settings,
//  which no extension API reaches, and brave:// pages cannot be scripted.
//
//  Leo streams every chat answer ("stream": true), and the vendor's proxy
//  refuses a stream, so only a lease works: the model provider's own key
//  and address, which Leo calls directly with a bearer key. A ship holds
//  one lease, so the key is the one Talon and this extension use; no
//  second key is minted. Pure: the key itself never comes back from here,
//  only its last four characters.

const CHAT_PATH = '/chat/completions'

export const LEO_STEPS = 'In Brave, open Settings, then Leo. Under Bring your own model, add a new model and paste these in.'

export const LEO_KEY_NOTE = 'This is your ship\'s lease, the same key Talon and this extension use: a ship holds only one. Leo spends from the same balance. Removing Armillary in Talon gives the lease back, and Leo stops with it.'

//  `inf` is /apps/armillary/api/inference ({base_url, key, mode, models});
//  `leaseDisabled` the account saying its lease ran out of credit, which is
//  why a ship answers proxy; `model` the one picked, else the first listed.
export function leoSetup(inf, leaseDisabled, model) {
  if (!inf || inf.mode !== 'lease') {
    return {
      cannot: leaseDisabled
        ? 'Your balance is empty, so your ship\'s lease is switched off. Leo works again once there is credit on the account.'
        : 'Leo streams its answers, and the vendor\'s ship does not pass a stream on. Leo needs a lease, a key straight to the model provider, and your ship holds none from this vendor.',
    }
  }
  const base = String(inf.base_url || '').trim().replace(/\/+$/, '')
  //  Brave refuses a plain http address that is not on this machine
  if (!base.startsWith('https://')) return { cannot: `Brave takes only an https address, and your ship's model provider is at ${base || 'no address'}.` }
  const key = String(inf.key || '').trim()
  if (!key) return { cannot: 'Your ship holds no key yet.' }
  const models = Array.isArray(inf.models) ? inf.models.filter((m) => typeof m === 'string' && m) : []
  const pick = models.includes(model) ? model : models[0]
  if (!pick) return { cannot: 'Your ship lists no models yet.' }
  return {
    ready: {
      label: `${pick} (Armillary)`,
      model: pick,
      models,
      endpoint: base.endsWith(CHAT_PATH) ? base : base + CHAT_PATH,
      keyTail: key.slice(-4),
    },
  }
}
