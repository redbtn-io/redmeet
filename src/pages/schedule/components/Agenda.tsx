import { useEffect, useRef, useState } from "react";
import { useMeetings } from "../../../hooks/meetings";


export default function Agenda({user, calendars}: any) {

    const start = new Date(new Date().setMonth(new Date().getMonth() - 2));
    const end = new Date(new Date().setMonth(new Date().getMonth() + 2));

    const todayRef = useRef<any>(null);
    const rangeRef = useRef([start, end]);
    const fetching = useRef(false);
    const meetingsRef = useRef([]);
    
    const [range, setRange] = useState([start, end]);
    const { loading, meetings } = useMeetings(user, calendars?.filter((c: any) => c.active).map((c: any) => c.name) || [], range);

    useEffect(() => {
        const bodyElemnt = document.getElementById('body');
        console.log(todayRef.current)
        if (todayRef.current && bodyElemnt) {
            bodyElemnt.scrollTo({
                top: todayRef.current.offsetTop - 250
            });
        }
    }, [todayRef.current]);

    useEffect(() => {
        if (fetching && meetings) {
            fetching.current = false;
        }
        meetingsRef.current = meetings;
    }, [meetings]);

    useEffect(() => {
        console.log(calendars?.filter((c: any) => c.active))
    }, [calendars]);

    useEffect(() => {
        const body = document.getElementById('body');
        if (body) {
            const handleScroll = () => {
                if (body.scrollTop / (body.scrollHeight - body.clientHeight) > 0.85 && !fetching.current) {
                    const lastDate: any = Object.keys(meetingsRef.current).pop()
                    const d = new Date(lastDate)
                    console.log(d)
                    rangeRef.current = [new Date(d.getTime() + 24 * 60 * 60 * 1000)]
                    fetching.current = true
                    setRange(rangeRef.current)
                    console.log('fetching', fetching)
                }
            };

            body.addEventListener('scroll', handleScroll);

            return () => body.removeEventListener('scroll', handleScroll);
        }
    }, []);

    if (loading) return <div>Loading...</div>

    return <div className="flex flex-col space-y-4 mx-auto">
        {!todayRef.current && <div className={`absolute top-52 md:top-72 left-0 right-0 bottom-0 bg-white p-2 z-200`}>
            Loading...
            </div>}
        {Object.keys(meetings).map((date: string) => {
            const MMDD = new Date(date).toLocaleDateString([], { month: 'numeric', day: 'numeric' });
            const weekday = new Date(date).toLocaleDateString('en-US', { weekday: 'short' }).toLocaleLowerCase();
            const isToday = new Date(date).toDateString() === new Date().toDateString();
            return <div className="flex space-x-2" ref={isToday ? todayRef : null} key={date}>
                <div className={`text-sm flex-1 flex flex-col items-center`}
                    style={{
                        fontVariant: 'small-caps',
                    }}>
                        <span className={`aspect-square ${ isToday ? 'text-[var(--primary-color)]' : 'text-gray-500'}`}>
                            <span className={`text-lg ${isToday && 'font-bold'} mx-auto`}>{weekday}</span>
                            <br/>
                            {MMDD}
                        </span>
                </div>
                <div className="flex-7 space-y-2 overflow-hidden">
                    {meetings[date].map((meeting: any) => {
                        const start = new Date(meeting.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                        const end = new Date(meeting.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                        const ended = new Date(meeting.end) < new Date();
                        const started = new Date(meeting.start) < new Date();
                        const ongoing = started && !ended;

                        return <div key={meeting.start} className={`flex flex-col rounded ${ongoing ? 'pulse' : ''}
                            ${ended ? 'bg-gray-400 opacity-35' : 'bg-[var(--primary-color)]'} text-white p-2`}>
                            <div className="text-sm">
                                <EllipsisText text={meeting.event} />
                            </div>
                            <div className="text-sm">{start + ' - ' + end}</div>
                        
                        </div>
                    })}
                    <hr className="mt-4 border-gray-300"/>
                </div>
            </div>
        })}
    </div>
}

const EllipsisText = ({ text }:any) => {
  const containerStyle = {
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };

  return (
    <div style={containerStyle}>
      {text}
    </div>
  );
};


