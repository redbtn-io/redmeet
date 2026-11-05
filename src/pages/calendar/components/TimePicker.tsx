import { useState } from "react";
import { createEvent } from "../../../calls/calendar";
import LoadingWheel from "../../../components/LoadingWheel";
import Form from "./Form";

function TimePicker({ params, setParams, times, setLoading, setResults, loadingWheel, meeting }: any) {

    function clickTime(time: any) {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        const timeselectElement = document.querySelector('.overflow-y-auto');
        if (timeselectElement) {
            if (params.get('time') === time) {
                if (window.innerWidth >= 768) {
                    timeselectElement.scrollTo({ top: 0, behavior: 'smooth' });
                } else {
                    timeselectElement.scrollIntoView({ behavior: 'smooth' });
                }
            } else {
                timeselectElement.scrollTo({ top: timeselectElement.scrollHeight, behavior: 'smooth' });
            }
        }

        if (params.get('time') === time) {
            params.delete('time');
        } else {
            params.set('time', time);
        }
        setParams(params);
        
    }


    

    return (
        <div className={`${params.get('date') ? 'overflow-y-auto' : 'hidden'} ${loadingWheel ? 'm-auto' : ''} space-y-4 p-1 w-full`} id="time-picker">
            { loadingWheel ? <>
                <p className="text-center text-gray-500">Loading available times...</p>
                <LoadingWheel />
            </> : <>
                <h3 className="text-lg font-medium">
                {new Date(new Date(params.get('date')).setDate(new Date(params.get('date')).getDate() + 1)).toDateString()  }
                </h3>
                <div className="grid grid-cols-2 gap-2">
                    {times.map((time: any) => (
                        <button
                            key={time}
                            className={`w-full p-2 rounded ${params.get('time') === time ? "bg-[var(--primary-color)] text-white" : "bg-gray-200"} cursor-pointer select-none`}
                            onClick={() => clickTime(time)}
                        >
                            {time}
                        </button>
                    ))}
                </div>
                <Form {...{params, setLoading, setResults, loadingWheel, setParams, meeting }} />
                
            </>}
        </div>
    );
}

export default TimePicker;

