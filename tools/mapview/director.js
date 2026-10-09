// Picks the live player worth watching. The stream plays DELAY_MS behind, so the director sees kills before they
// play and cuts to the killer in time. Hunters are allies and zombies axis, as on nL's zombies server.

export const DELAY_MS = 3000
// A pick stays this long unless a kill is coming, so the camera does not flicker between players.
const HOLD_MS = 6000
// How much more another player must score to take over once the hold is up.
const SWITCH_MARGIN = 15
// Kills this recent count toward a streak.
const STREAK_MS = 30000
// A zombie this close to the last hunter is closing in on it.
const CLOSING_IN = 800
// Opposing players this close are fighting.
const FIGHT_RANGE = 600

export function createDirector(live) {
  let current = null

  return {
    // The player to watch: { name, reason }, or null when no one is shown.
    pick(now) {
      const roster = live.roster()
      if (!roster.length) return (current = null)
      const scores = score(roster, now)
      const best = scores.reduce((a, b) => (b.score > a.score ? b : a))
      const mine = current && scores.find((s) => s.id === current.id)
      const switches = !mine || (best.id !== mine.id && (best.urgent || (now - current.since > HOLD_MS && best.score > mine.score + SWITCH_MARGIN)))
      if (switches) current = { id: best.id, since: now }
      const shown = switches ? best : mine
      return { name: shown.name, reason: shown.reason }
    },
  }

  // Every player's score and the reason that weighs most in it; `urgent` when a kill of theirs is about to play.
  function score(roster, now) {
    const nameOf = (id) => roster.find((p) => p.id === id)?.name ?? 'someone'
    const hunters = roster.filter((p) => p.team === 'allies')
    const zombies = roster.filter((p) => p.team === 'axis')
    const lastHunter = hunters.length === 1 && zombies.length ? hunters[0] : null
    return roster.map((p) => {
      const reasons = [[1, 'watching']]
      let urgent = false
      const kill = live.upcomingKills().find((k) => k.attacker === p.id)
      if (kill) {
        urgent = true
        reasons.push(kill.victim === lastHunter?.id ? [120, 'about to kill the last hunter'] : [100, `about to kill ${nameOf(kill.victim)}`])
      }
      if (p === lastHunter) reasons.push([70, 'the last hunter'])
      if (lastHunter && p.team === 'axis') {
        const d = distance(p.origin, lastHunter.origin)
        if (d < CLOSING_IN) reasons.push([90 - d / 20, `closing in on the last hunter, ${lastHunter.name}`])
      }
      const streak = live.kills().filter((k) => k.attacker === p.id && k.at > now - STREAK_MS).length
      if (streak >= 2) reasons.push([streak * 15, `${streak} kills in ${STREAK_MS / 1000} s`])
      const enemies = roster.filter((q) => q.team !== p.team)
      const nearest = enemies.length ? Math.min(...enemies.map((q) => distance(p.origin, q.origin))) : Infinity
      if (nearest < FIGHT_RANGE) reasons.push([10 + 30 * (1 - nearest / FIGHT_RANGE), 'in a fight'])
      const total = reasons.reduce((sum, [s]) => sum + s, 0)
      const top = reasons.reduce((a, b) => (b[0] > a[0] ? b : a))
      return { id: p.id, name: p.name, score: total, reason: top[1], urgent }
    })
  }
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}
