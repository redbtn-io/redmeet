import { useEffect, useState } from 'react';
import AppointmentPicker from './components/Picker'
import LoadingPage from './components/LoadingPage'
import ResultMessage from './components/ResultMessage';
import { useNavigate, useParams } from 'react-router';
import { useUser } from '../../hooks/user';

function Scheduler() {

  const [load, setLoading] = useState(false);
  const [results, setResults] = useState(false);
  const {user} = useParams();
  const { loading, userDetails } = useUser(user || "");

  const lightenColor = (color: string, percent: number) => {
      const num = parseInt(color.replace("#", ""), 16),
          amt = Math.round(2.55 * percent),
          R = (num >> 16) + amt,
          G = (num >> 8 & 0x00FF) + amt,
          B = (num & 0x0000FF) + amt;
      return `#${(0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 + (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 + (B < 255 ? B < 1 ? 0 : B : 255)).toString(16).slice(1)}`;
  };

  useEffect(() => {
    if (!userDetails || !userDetails.color) return;
    const host = 'https://' + window.location.host;
    const website = window.location.host.split('.').slice(-2)[0];
    const color = userDetails.origins[host].color || userDetails.color;
    document.getElementById('root')!.style.setProperty('--primary-color', color || 'red');
    const highlightColor = lightenColor(color || 'red', 20);
    document.documentElement.style.setProperty('--highlight-color', highlightColor);
    document.title = `Meet with ${userDetails.name} - ${website}`;
  }, [userDetails]);

  return (
    <div className='w-full'>
      {load && <LoadingPage {...{load, setLoading}} />}
      {results && <ResultMessage {...{ results, setResults }} />}
      {!load && !results && <>
        <AppointmentPicker {...{setLoading, setResults, loading, userDetails}}/>
      </>}
    </div>
  )
}

export default Scheduler
