const user = window.location.pathname.split('/')[1];

export async function createEvent(event: any) {
    try {
        console.log('event', event);
        const response = await fetch(`https://api.redbtn.io/event?user=${user}`, {
            method: 'POST',
            headers: {
            'Content-Type': 'application/json',
            },
            body: JSON.stringify(event),
        });
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error:', error);
    }
}

export async function getEvents({day, calendars, user, range, max}: {day?: string, calendars: string[], user?: any, range?: string[], max?: number} = {
    calendars: included
}) {
    try {
        let events: any[] = []
        let token: string
        let headers: any = {
            'Content-Type': 'application/json',
        }

        if (user?.email) {
            token = await user.getIdToken();
            headers = {
                ...headers,
                'Authorization': `Bearer ${token}`
            }
        }

        const response = await fetch(`https://api.redbtn.io/events?calendars=${calendars.join(',')}&user=${user}${range ? '&range=' + range.join(',') : ''}${max ? '&max=' + max : ''}`, {
            method: 'GET',
            headers
        });
        
        const data = await response.json();
        
        events = [...data];
        if (day) {
            events = events.filter(event => {
                return event.start.includes(day);
            });
        }
        return events;
    } catch (error) {
        console.error('Error:', error);
    }
}

export async function getCalendars(user: any) {
    try {
        const token = await user.getIdToken();
        const response = await fetch(`https://api.redbtn.io/calendars`,
            {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            }
        );
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error:', error);
    }
}

export async function availableTimes( {date, calendars}: {date: string, calendars: string[]}) {
    const events = await getEvents({ calendars, user }) || [];

    const formattedDate = date.split('-').map((part, index) => index === 0 ? part : part.replace(/^0+/, '')).slice(1).concat(date.split('-')[0]).join('/');
    const filteredEvents = events.filter(event => {
        return event.start.includes(formattedDate);
    });

    const weekend = new Date(formattedDate).getDay() === 0 || new Date(formattedDate).getDay() === 6;

    let times = weekend ? [
        "10:00AM", "10:30AM", "11:00AM", "11:30AM", "12:00PM",
        "12:30PM", "1:00PM", "1:30PM", "2:00PM",
    ] : [
        "10:00AM", "10:30AM", "11:00AM", "11:30AM", "12:00PM",
        "12:30PM", "1:00PM", "1:30PM", "2:00PM",
        "2:30PM", "3:00PM", "3:30PM", "4:00PM", "4:30PM",
        "5:00PM", "5:30PM", "6:00PM", "6:30PM", "7:00PM",
        "7:30PM", "8:00PM"
    ]

    let allTimes = ['12:00AM', '12:30AM', '1:00AM',
        '1:30AM', '2:00AM', '2:30AM', '3:00AM', '3:30AM',
        '4:00AM', '4:30AM', '5:00AM', '5:30AM', '6:00AM',
        '6:30AM', '7:00AM', '7:30AM', '8:00AM', '8:30AM',
        '9:00AM', '9:30AM', '10:00AM', '10:30AM', '11:00AM',
        '11:30AM', '12:00PM', '12:30PM', '1:00PM', '1:30PM',
        '2:00PM', '2:30PM', '3:00PM', '3:30PM', '4:00PM',
        '4:30PM', '5:00PM', '5:30PM', '6:00PM', '6:30PM',
        '7:00PM', '7:30PM', '8:00PM', '8:30PM', '9:00PM',
        '9:30PM', '10:00PM', '10:30PM', '11:00PM', '11:30PM'
    ]
    
    if (filteredEvents.length) {
        let takenTimes: any[] = [];
        for (let i = 0; i < filteredEvents.length; i++) {
            const calendar = filteredEvents[i].calendar.toLowerCase();
            let slotsBefore = calendar === 'life time' ? 2 : 1;
            const start = filteredEvents[i].start.split(' ')[1].slice(0, -3) + filteredEvents[i].start.split(' ')[2].toUpperCase();
            const end = filteredEvents[i].end.split(' ')[1].slice(0, -3) + filteredEvents[i].end.split(' ')[2].toUpperCase();
            const endIndex = end === '12:00AM' ? allTimes.length : (allTimes.indexOf(end) !== -1 ? allTimes.indexOf(end) + 1 : allTimes.length);
            const timesBetween = allTimes.slice(allTimes.indexOf(start), endIndex);
            const timesBefore = allTimes.slice(Math.max(allTimes.indexOf(start) - slotsBefore, 0), allTimes.indexOf(start));
            const blockedTimes = [...timesBetween, ...timesBefore];
            takenTimes = [...takenTimes, ...blockedTimes];
        }
        allTimes = allTimes.filter(time => !takenTimes.includes(time));
    }

    const currentDate = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }).split(', ')[0].split('/').map((part, index) => index === 0 ? part : part.replace(/^0+/, '')).concat(new Date().getFullYear().toString()).slice(0, 3).join('/');

    if (formattedDate === currentDate) {
        const currentTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
        const currentHour = parseInt(currentTime.split(':')[0]);
        const currentMinutes = parseInt(currentTime.split(':')[1].slice(0, 2));
        const currentPeriod = currentTime.split(' ')[1];

        const twoHoursLater = new Date();
        twoHoursLater.setHours(currentHour + (currentPeriod === 'PM' && currentHour !== 12 ? 12 : 0) + (currentPeriod === 'AM' && currentHour === 12 ? -12 : 0) + 2);
        twoHoursLater.setMinutes(currentMinutes);

        const filteredTimes = allTimes.filter(time => {
            const [hour, minutePeriod] = time.split(':');
            const minute = minutePeriod.slice(0, 2);
            const period = minutePeriod.slice(2);

            const timeDate = new Date();
            timeDate.setHours(parseInt(hour) + (period === 'PM' && parseInt(hour) !== 12 ? 12 : 0));
            timeDate.setMinutes(parseInt(minute));

            return timeDate > twoHoursLater;
        });

        allTimes = filteredTimes;
    }

    return times.filter(time => allTimes.includes(time));
}


const included = [
    'Appointments',
    'george8794@gmail.com',
    'Life Time',
]

function regularToMilitary(time: string) {
    const [hour, minutePeriod] = time.split(':');
    const minute = minutePeriod.slice(0, 2);
    const period = minutePeriod.slice(2);

    return `${parseInt(hour) + (period === 'PM' && parseInt(hour) !== 12 ? 12 : 0)}:${minute}`;
};