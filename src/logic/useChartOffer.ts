import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { chartOffer, getChartAccess } from './chartJobs';

/**
 * What this viewer is offered for a pasted link no song has, on the home page
 * and in the party queue alike: 'offer' | 'signIn' | null (chartJobs.js
 * chartOffer; the backend's switch decides who).
 */
export function useChartOffer() {
  const { user } = useAuth();
  const [access, setAccess] = useState(null);
  useEffect(() => {
    let on = true;
    getChartAccess().then(a => { if (on) setAccess(a); });
    return () => { on = false; };
  }, []);
  return chartOffer(access, user);
}
