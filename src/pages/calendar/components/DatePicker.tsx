import { useEffect } from "react";
import { availableTimes } from "../../../calls/calendar";

function CalendarPicker({ year, setYear, month, setMonth, dates, setSelectedTime, setTimes, loadingWheel, 
    setLoadingWheel , params, setParams, meeting}: any) {
    
    useEffect(() => {
        if (params.get('date')) setLoadingWheel(true);
        async function getTimes(){
            const available = await availableTimes({
                date: params.get('date'),
                calendars: meeting.calendars
            });
            setTimes(available);
            setLoadingWheel(false);
            setTimeout(() => {
                const timeElement = document.getElementById('time-picker');
                if (timeElement) {
                    timeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 50);
        }
        if (params.get('date')) {
            getTimes();
        }

    }, [params.get('date')]);

    function dateClick(item: any) {
        if (new Date(item.date + 'T00:00:00').getMonth() !== month) {
            switchMonth(item.date > params.get('date') ? 1 : -1);
        }
        const timepick = document.getElementById('time-picker');
        if (timepick) timepick.scrollTop = 0;
        if (params.get('date') === item.date) return;
        setParams({ date: item.date });

        const element = document.getElementById('date-picker');
        if (element) {
            setTimeout(() => {
                element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                setTimeout(() => {
                    window.scrollBy({ top: document.body.scrollHeight, behavior: 'smooth' });
                }, 100);
            }, 200);
        }
    }

    function switchMonth(direction: number) {
        setMonth((prev: number) => {
            const newMonth = (prev + direction + 12) % 12;
            const newYear = year + (newMonth === 11 && direction === -1 ? -1 : newMonth === 0 && direction === 1 ? 1 : 0);
            const currentDate = new Date();
            if (newYear < currentDate.getFullYear() || (newYear === currentDate.getFullYear() && newMonth < currentDate.getMonth())) {
                return prev;
            }
            if (newMonth === 11 && direction === -1) {
                setYear(newYear);
            } else if (newMonth === 0 && direction === 1) {
                setYear(newYear);
            }
            return newMonth;
        })
    }

    return (
        <div id='date-picker' className={`space-y-5 p-2 md:p-0 `}>  
            <h2 className="text-xl font-bold select-none">Select a Date & Time</h2>
            <div className="flex justify-between items-center">
                <button onClick={
                    () => switchMonth(-1)
                } className="month-button">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="w-3 h-3">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                </button>
                <h3 className="font-medium text-2xl select-none">
                    {new Date(year, month).toLocaleString('default', { month: 'long' })} {year !== new Date().getFullYear() ? year : ''}
                </h3>
                <button onClick={
                    () => switchMonth(1)
                } className="month-button">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="w-3 h-3">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                </button>
            </div>
            <div id="weekday-title" className="grid grid-cols-7 gap-2 text-center font-bold">
                <div>S</div>
                <div>M</div>
                <div>T</div>
                <div>W</div>
                <div>T</div>
                <div>F</div>
                <div>S</div>
            </div>
            <div className="grid grid-cols-7 gap-2 mb-6 md:mb-0 justify-items-center">
                {dates.map((item: any, index: number) => { 
                    const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
                    const currentTime = regularToMilitary(new Date(now).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
                        .replace(' ', ''));
                    const isToday = new Date(now).toLocaleDateString('en-US') === new Date(item.date + 'T00:00:00').toLocaleDateString('en-US', { timeZone: 'America/New_York' });

                    const isWeekend = [0, 6].includes(new Date(item.date + 'T00:00:00').getDay());
                    const cutoffTime = isWeekend ? "12:00PM" : "3:00PM";
                    const isTooLate = isToday && isLater(currentTime, regularToMilitary(cutoffTime));

                    return (
                        <button
                            key={index}
                            className={`p-0 aspect-square h-12 text-center mx:auto
                                ${(item.isPast || isTooLate) ? "unavailable-date" : 
                                params.get('date') === item.date ? "selected-date" : "available-date"}
                                ${new Date(item.date + 'T00:00:00').getMonth() !== month ? "off-month-date" : ""}
                            `}
                            onClick={() => dateClick(item)}
                            disabled={item.isPast || isTooLate || (loadingWheel === true)}
                        >
                            {item.date ? `${new Date(item.date + 'T00:00:00').getDate()}` : ""}
                        </button>
                    )
                })}
            </div>
        </div>
    );
}

export default CalendarPicker;

function regularToMilitary(time: string) {
    const [hour, minutePeriod] = time.split(':');
    const minute = minutePeriod.slice(0, 2);
    const period = minutePeriod.slice(2);

    return `${parseInt(hour) + (period === 'PM' && parseInt(hour) !== 12 ? 12 : 0)}:${minute}`;
};

function isLater(time1: string, time2: string) {
    const [hour1, minute1] = time1.split(':');
    const [hour2, minute2] = time2.split(':');

    if (parseInt(hour1) > parseInt(hour2)) {
        return true;
    }
    if (parseInt(hour1) === parseInt(hour2) && parseInt(minute1) > parseInt(minute2)) {
        return true;
    }
    return false;

}