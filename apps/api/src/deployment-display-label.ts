import type { Deployment } from "./store";

function legacy(item: Deployment) {
  return new RegExp(`-${item.environment}-(?:niq|client-cloud)-[a-f0-9]{8}$`, "i").test(item.name);
}

export function deploymentDisplayLabel(item: Deployment, siblings: Deployment[]) {
  if (!legacy(item)) return item.name;
  const base = item.environment.charAt(0).toUpperCase() + item.environment.slice(1);
  const occupied = new Set(siblings.filter(row => !legacy(row)).map(row => row.name.trim().toLowerCase()));
  for (const [index, row] of siblings.filter(row => row.environment === item.environment).entries()) {
    if (!legacy(row)) continue;
    let number = index + 1;
    let label = number === 1 ? base : `${base} ${number}`;
    while (occupied.has(label.toLowerCase())) label = `${base} ${++number}`;
    occupied.add(label.toLowerCase());
    if (row.id === item.id) return label;
  }
  return base;
}
