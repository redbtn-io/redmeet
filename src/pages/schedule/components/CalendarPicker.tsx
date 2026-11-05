import { useEffect, useState } from "react";


export default function CalendarPicker({ user, calendars, loading, setCalendars }: any) {

    const [ show , setShow ] = useState<boolean>(false)
    const [ loadingCalendars, setLoadingCalendars ] = useState<boolean>(false)

    useEffect(() => {
        if (calendars) {
            console.log(calendars)
        }
    }, [calendars])

    function checked(calendar: any) {
        setLoadingCalendars(true)
        if (calendars) {
            const newCalendars = calendars.map((c: any) => {
                if (c.name === calendar.name) {
                    c.active = !c.active
                }
                return c
            })
        }
        setLoadingCalendars(false)
    }



    if (loading) return <div>Loading...</div>


    return <>
        <div className="text-sm text-gray-500 cursor-pointer" onClick={() => setShow(!show)}>Calendars ▼</div>
        <div className="relative"></div>
        {show && !loadingCalendars && <div className="absolute bg-white w-56 rounded shadow-lg mt-6 right-2 p-2 z-100" >
            {calendars.map((calendar: any) => {
                console.log(calendar)
                return <div key={calendar.name} className="p-4 hover:bg-gray-100 cursor-pointer">
                    <div className="flex items-center">
                        <div className="flex-1 w-10"><input type="checkbox" defaultChecked={calendar.active} onChange={()=>checked(calendar)}/></div>
                        <div className="flex-5 text-left overflow-hidden overflow-ellipsis whitespace-nowrap">{calendar.name}</div>
                    </div>
                </div>
            })}
        </div>}
    </>
}