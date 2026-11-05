// Shared by the lobby UI and authoritative server so their start rules agree.
export function getLobbyReadiness(roster) {
  const players = Array.from(roster);
  const teams = [0, 1].map(team => {
    const crew = players.filter(player => player.team === team);
    const bots = crew.filter(player => player.bot).length;
    return { team, count: crew.length, humans: crew.length - bots, bots, queens: crew.filter(player => player.role === 'queen').length, quota: Math.ceil(crew.length / 5) };
  });
  const reason = teams.some(team => team.count === 0) ? 'players' : teams.some(team => team.queens !== team.quota) ? 'queens' : 'ready';
  return { teams, ready: reason === 'ready', reason };
}
