// Labels describe a particular visible collection; IDs remain the persistent identity.
export function labelMarkers<T extends { id: string }>(markers: readonly T[]): (T & { label: number })[] {
  return markers.map((marker, index) => ({ ...marker, label: index + 1 }));
}
