import { useEffect, useRef, useState } from "react";
import { getEvents } from "../calls/calendar";


export function useMeetings(user: any, calendars: string[], range? :any[], max?: number) {

  const loading = useRef(true);
  const [meetings, setMeetings] = useState<any>(null);
  const isInitialRender = useRef(true);
  const options = {calendars, user, range, max}

  useEffect(() => { 
    console.log('useMeetings', options)
    async function fetchCalendars() {
      if (loading.current) {
        const data = await getEvents(options)
        if (!data) return
        const meets = meetingObject(data)
        setMeetings(meets)
        loading.current = false
      }
    }
    fetchCalendars()
  }, []);

  useEffect(() => {
    if (loading.current || !meetings) return
    console.log('range', range)
    loading.current = true
    getEvents(options).then((data) => {
      if (!data) return
      const newMeets = meetingObject(data)
      const meets = {...meetings, ...newMeets}
      setMeetings(meets)
      loading.current = false
    });
  }, [range]);

  useEffect(() => {
    async function fetchCalendars() {
      if (loading.current || !isInitialRender.current) return
      else {
        loading.current = true
        const data = await getEvents(options)
        if (!data) return
        const meets = meetingObject(data)
        setMeetings(meets)
        loading.current = false
        isInitialRender.current = false
      }
    }
    fetchCalendars()
  }, [calendars]);

  return { loading: loading.current, meetings };
}

function meetingObject(meetings: any[]){
  const meetingsObject: any = {}
  meetings.forEach((meeting) => {
    const date = new Date(meeting.start).toLocaleDateString();
    if (!meetingsObject[date]) {
      if (Object.keys(meetingsObject).length === 0) {
        meetingsObject[date] = [];
      }

      let latestDate: any = Object.keys(meetingsObject).pop();
      do {
        const d = new Date(latestDate);
        d.setDate(d.getDate() + 1);
        meetingsObject[d.toLocaleDateString()] = [];
        latestDate = d.toLocaleDateString();
      } while (latestDate !== date);
    }
    meetingsObject[date].push(meeting);
  })
  return meetingsObject;
}