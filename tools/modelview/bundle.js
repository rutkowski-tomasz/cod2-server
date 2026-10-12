// Builds the page bundle: one or more views, each a rig with the animations it can play, packed by mapview's
// bundle.js. A model target has one view; a weapon has `first` (hands with the gun hanging from them, as mapview's
// player.js hangs them) and `third` (a player holding it).
import { buildRig, buildGun, buildWeapon, buildAnim, readWeaponFile, holding, xmodelPath, PLAYER } from '../mapview/bundle.js'

// The standing idle mp/playeranim.script picks by weapon class; the rest take the two-handed rifle's.
const THIRD_PERSON_IDLE = { pistol: 'pb_stand_alert_pistol', grenade: 'pb_stand_grenade_pullpin' }
const RIFLE_IDLE = 'pb_stand_alert'

// `target` is a weapon file name under weapons/mp/ (mp40_mp) or an xmodel (xmodel/crate01 or crate01).
// `anims` are xanim names, or in first person the names of the weapon's view animations (idle, reload…). Each xanim
// goes to the view whose rig has the most of the bones it moves: a player animation shares the fingers with
// a viewmodel. It holds the view's idle pose on the bones it does not move, as the game plays a torso animation over
// the legs' idle and a view animation over the hip pose. The first name a view has is the one it starts on.
export function buildModelBundle(target, search, { anims = [], attach = [], hands = '', body = PLAYER.models } = {}) {
  const missing = []
  const weapon = !target.startsWith('xmodel/') && readWeaponFile(target, search)
  const views = weapon ? weaponViews() : { model: modelView() }
  const loaded = {}
  for (const name of anims) {
    if (Object.values(views).some((v) => v.anims[name])) continue
    const anim = buildAnim(name.replace(/^xanim\//, ''), search)
    if (anim) loaded[name] = anim
    else missing.push(`xanim/${name.replace(/^xanim\//, '')}`)
  }
  const share = (v, anim) => anim.bones.filter((a) => [...v.rig.bones, ...(v.gun?.bones ?? [])].some((b) => b.name === a.name)).length
  for (const [name, anim] of Object.entries(loaded)) {
    const view = Object.values(views).reduce((best, v) => (share(v, anim) > share(best, anim) ? v : best))
    view.anims[name] = holding(anim, view.anims[view.start])
  }
  for (const v of Object.values(views)) v.start = anims.find((n) => v.anims[n]) ?? v.start
  return { name: target, kind: weapon ? 'weapon' : 'model', views, missing }

  function modelView() {
    const models = [xmodelPath(target), ...attach.map(xmodelPath)]
    const rig = buildRig(models, search)
    if (!rig) throw new Error(`model not found or unreadable: one of ${models.join(', ')}`)
    return { rig, anims: {}, start: null }
  }

  function weaponViews() {
    const out = {}
    const gun = buildGun(target, search)
    const handModel = hands || weapon.handModel
    const handsRig = handModel && buildRig([xmodelPath(handModel)], search)
    if (gun && handsRig) {
      const { anims: own, flash, ...gunRig } = gun
      out.first = { rig: handsRig, gun: gunRig, anims: Object.fromEntries(Object.entries(own).filter(([, a]) => a)), start: 'idle', eye: true }
    } else missing.push(`first person: ${[handModel, weapon.gunModel].filter(Boolean).map(xmodelPath).join(' or ') || 'no handModel or gunModel'}`)
    const player = buildRig(body.map(xmodelPath), search)
    if (player) {
      const { flash, ...held } = buildWeapon(target, search) ?? {}
      if (!held.bones && weapon.worldModel) missing.push(`held: ${weapon.worldModel}`)
      const idle = THIRD_PERSON_IDLE[weapon.weaponClass] ?? RIFLE_IDLE
      const anim = buildAnim(idle, search)
      if (!anim) missing.push(`xanim/${idle}`)
      out.third = { rig: player, held: held.bones ? held : null, anims: anim ? { [idle]: anim } : {}, start: anim ? idle : null }
    } else missing.push(`third person: one of ${body.map(xmodelPath).join(', ')}`)
    if (!Object.keys(out).length) throw new Error(`${target}: neither view could be built`)
    return out
  }
}
