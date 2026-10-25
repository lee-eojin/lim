export function addScore(board, player, points) {
  const entry = board.find((item) => item.player === player);
  if (entry) {
    entry.points += points;
  } else {
    board.push({ player, points });
  }
  return board;
}
