/**
 * A host who never typed a name is called "Host" in the language their
 * browser was in, so "Gastgeber" or "ホスト" in a log is not a person's
 * name. localizedHostNames collects every translation of that default
 * from the i18n resources; hostLabel marks a name that is one of them,
 * "Hôte (host)". The English "Host" is left alone: it reads as what it is.
 */
export function localizedHostNames(resources) {
  const names = new Set();
  for (const r of Object.values(resources ?? {})) {
    const name = r?.translation?.party?.defaultHost ?? r?.party?.defaultHost;
    if (typeof name === 'string' && name && name !== 'Host') names.add(name);
  }
  return names;
}

export function hostLabel(name, hostNames, tag = 'host') {
  return typeof name === 'string' && hostNames.has(name) ? `${name} (${tag})` : name;
}
