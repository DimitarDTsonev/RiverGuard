import sectionContent from './river-sections-content.json' with { type: 'json' };

/**
 * @param {Pick<import('./types').Station, 'name' | 'river'>} station
 * @returns {import('./types').RiverSection}
 */
export function emptyRiverSection(station) {
  return {
    name: `${station.river} · ${station.name}`.slice(0, 160),
    position: 'unknown',
    terrain: 'unknown',
    channel: '',
    flowRegime: '',
    floodRisks: '',
    monitoringFocus: '',
    waterBodyCode: '',
    typologyCode: '',
    status: 'draft',
    sourceTitle: '',
    sourceUrl: '',
    reference: '',
    reviewedBy: '',
    reviewedAt: '',
  };
}

/**
 * Обогатява старите записи само при четене. Съхраненият профил винаги има
 * предимство; пример по река или име на населено място не определя участък.
 * @template {import('./types').Station} T
 * @param {T} station
 * @returns {T & {riverSection: import('./types').RiverSection}}
 */
export function enrichStationMetadata(station) {
  const defaults = emptyRiverSection(station);
  const example = sectionContent.profiles.find(profile =>
    profile.stationId === station.id && profile.river === station.river &&
    profile.lat === station.lat && profile.lng === station.lng);
  const profile = station.riverSection ?? example?.riverSection;
  const riverSection = { ...defaults };
  if (profile && typeof profile === 'object' && !Array.isArray(profile)) {
    for (const key of Object.keys(defaults)) {
      if (Object.hasOwn(profile, key)) riverSection[key] = profile[key];
    }
  }
  return { ...station, riverSection };
}
