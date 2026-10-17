export function split(names, count, rand = Math.random) {
  const list = names.map((n) => n.trim()).filter(Boolean);
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  const teams = Array.from({ length: Math.max(1, count) }, () => []);
  list.forEach((n, i) => teams[i % teams.length].push(n));
  return teams;
}
if (typeof document !== "undefined") {
  document.getElementById("go").addEventListener("click", () => {
    const teams = split(document.getElementById("names").value.split("\n"), Number(document.getElementById("count").value));
    document.getElementById("out").innerHTML = teams.map((t) => `<li>${t.join(", ")}</li>`).join("");
  });
}
