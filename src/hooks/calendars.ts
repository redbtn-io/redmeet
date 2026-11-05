import { useEffect, useState } from "react";
import { getCalendars } from "../calls/calendar";


export function useCalendars({ user }: any) {
    const [loading, setLoading] = useState<boolean>(true);
    const [calendars, setCalendars] = useState<any>(null);

    useEffect(() => {
        getCalendars(user).then((data) => {
            setLoading(false);
            setCalendars(data);
        });
    }, [user]);

    return { loading, calendars };
}