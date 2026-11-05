import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useCalendars } from "../../hooks/calendars";
import { useLink } from "../../hooks/link";
import BaseLayout from "../../layouts/Base";
import BodyLayout from "../../layouts/Body";
import HeroLayout from "../../layouts/Hero";
import NavLayout from "../../layouts/Nav";
import Agenda from "./components/Agenda";
import CalendarPicker from "./components/CalendarPicker";


export default function Schedule({user, logOut}: any) {

    
    const { calendars:startingCalendars, loading } = useCalendars({ user });
    const [calendars, setCalendars] = useState<any>(null);

    const { loading: linkLoading, link } = useLink(user);

    const [settings, setSettings] = useState(false);

    useEffect(() => {
        if (!user) window.location.href = '/';
        else document.title = `${user.displayName}'s Schedule`
    }, [user]);

    useEffect(() => {
        document.getElementById('root')!.style.setProperty('--primary-color', 'red')
        
    },[]);

    useEffect(() => {
        setCalendars(startingCalendars);
    }, [startingCalendars]);

    useEffect(() => {
        console.log(link)
    }, [link]);

    return user ? <>
    <BaseLayout>
        <NavLayout>
            {loading && <h3>Loading...</h3>}
            { !loading && <>
                <h3>{user.displayName}'s Schedule</h3> 
            </>}   
            <h2 className="float-right cursor-pointer" onClick={()=>setSettings(!settings)}>{settingsGear}</h2>
            {settings && <div className="absolute top-12 right-0 p-4 w-36 shadow-lg rounded-lg text-gray-700 space-y-4 text-right bg-white">
                <div><Link to="/settings">Settings</Link></div>
                <div onClick={logOut}>Log out</div>
            </div>}

        </NavLayout>  

        <HeroLayout>
            <div className="w-16 h-16 bg-gray-200 rounded-full mx-auto">
                <img src={user.photoURL} alt={user.displayName} className="w-16 h-16 rounded-full"/>
            </div>
            <br/>
            <div className={`flex justify-between items-center w-full max-w-2xl`}>
                <div className="flex flex-col">
                    <h2 className="float-right cursor-pointer text-right text-sm text-gray-600"><Link to={`/${link}`}>Booking Link 🔗</Link></h2>
                </div>
                <div className="flex flex-col">
                    <p className="text-sm text-gray-600">{user.email}</p>
                </div>
                <div className="flex flex-col">
                    <CalendarPicker {...{user, calendars, setCalendars}} />
                </div>

            </div>
        </HeroLayout>
        <BodyLayout>
            {loading || linkLoading && <p>Loading...</p>}
            
            {!loading && calendars && <Agenda {...{user, calendars}} />}

            <Footer/>

        </BodyLayout>
    </BaseLayout>

    </> : 
    <>
        Redirecting...
    </>
}

const settingsGear = <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#eee"><path d="m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm70-80h79l14-106q31-8 57.5-23.5T639-327l99 41 39-68-86-65q5-14 7-29.5t2-31.5q0-16-2-31.5t-7-29.5l86-65-39-68-99 42q-22-23-48.5-38.5T533-694l-13-106h-79l-14 106q-31 8-57.5 23.5T321-633l-99-41-39 68 86 64q-5 15-7 30t-2 32q0 16 2 31t7 30l-86 65 39 68 99-42q22 23 48.5 38.5T427-266l13 106Zm42-180q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Zm-2-140Z"/></svg>


export function Footer(){
    return <div className="flex justify-center items-center text-gray-500 text-sm">
        <p>Powered by <a href="https://redbtn.io" target="_blank" className="hover:text-gray-700 text-[var(--primary-color)]"> redbtn</a></p>
    </div>
}