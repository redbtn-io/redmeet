import { useEffect, useState } from "react";
import { createEvent } from "../../../calls/calendar";

export default function Form({ params, setLoading, setResults, setParams, meeting }: any) {

    const [comments, setComments]: any = useState(false);
    const [phoneNumber, setPhoneNumber] = useState<string>("");
  
    const [email, setEmail] = useState<string>("");
    const [name, setName] = useState<string>("");

    async function clickSubmit(e?: any) {
        if (e) e.preventDefault();
        // require one or both
        if (!phoneNumber && !email) {
            alert('Please enter at least a phone number or an email address.');
            return;
        }
        // check number formatting
        if (phoneNumber && phoneNumber.length < 14) {
            alert('Please enter a valid phone number.');
            return;
        }
        // check email formatting
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (email && !emailPattern.test(email)) {
            alert('Please enter a valid email address.');
            return;
        }
        // check name formatting
        if (name.length < 2) {
            alert('Please enter your name.');
            return;
        }
        setLoading("Scheduling...");
        const event = {
            summary: `${meeting.name}${name ? ' with ' + name : ''}`,
            location: 'Virtual',
            description: `${name}${phoneNumber ? ' - ' + phoneNumber : ''}`,
            start: {
                dateTime: convertTime(params.get('date'), params.get('time')),
                timeZone: 'America/New_York'
            },
            end :{
                dateTime: convertTime(params.get('date'), params.get('time'), meeting.length),
                timeZone: 'America/New_York'
            },
            attendees: email ? [
                { email : email, displayName: name },
            ] : [],
            extendedProperties: {
                private: {
                    name: name,
                    email: email,
                    phone: phoneNumber,
                    comments: comments,
                    bookedVia: 'website'
                }
            }
        }
        const result = await createEvent(event);
        if (result) {
            setPhoneNumber('');
            setEmail('');
            setName('');
            setLoading(false);
            setResults(`Scheduled for ${params.get('time')} on ${new Date(params.get('date') + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`);
            params.delete('time');
            params.delete('date');
            setParams(params);
        } else {
            setResults(`Error for ${params.get('time')} on ${new Date(params.get('date') + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`);
            setLoading(false);
        }
    }

    
    function changeNumber(e: any) {
        const formattedNumber = e.replace(/\D/g, '').slice(0, 10);
        if (formattedNumber.length > 3) {
            setPhoneNumber(`(${formattedNumber.slice(0, 3)}) ${formattedNumber.slice(3, 6)}${formattedNumber.length > 6 ? '-' + formattedNumber.slice(6, 10) : ''}`);
        } else {
            setPhoneNumber(formattedNumber);
        }
    }

    return <>
        <form className="space-y-2" onSubmit={clickSubmit}> 
            <input
                type="text"
                placeholder="Name"
                className="input-field"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
            />
            <input
                type="email"
                placeholder="Email"
                className="input-field"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
            />
            <div className="flex space-x-2">
                <input
                    type="tel"
                    placeholder="Phone Number"
                    className="input-field flex-2"
                    value={phoneNumber}
                    onChange={(e) => changeNumber(e.target.value)}
                    required
                />
                <button
                    className="flex-1 p-2 rounded cursor-pointer"
                    onClick={(e) => {
                        e.preventDefault();
                        setComments(comments !== false ? false : '');
                    }}
                >
                    Comments <span style={{ color: 'var(--primary-color)' }}>{comments !== false ? '▲' : '▼'}</span>
                </button>
            </div>

            {comments !== false && <textarea
                placeholder="Comments"
                className="input-field flex-1 resize-none"
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                rows={1}
                style={{ overflow: 'hidden', height: 'auto' }}
                onInput={(e) => {
                    const target = e.target as HTMLTextAreaElement;
                    target.style.height = 'auto';
                    target.style.height = `${target.scrollHeight}px`;
                }}
                required
            />}

            <button
                className={`w-full p-3 bg-[var(--primary-color)] text-white rounded cursor-pointer
                    ${(!params.get('time') || !params.get('date') || (!email && !phoneNumber) || !name) ? "opacity-50" : ""}`
                }
                disabled={(!params.get('time') || !params.get('date') || (!email && !phoneNumber) || !name)}
                onClick={clickSubmit}
            >
            {params.get('time') ? `Schedule for ${params.get('time')} on ${new Date(params.get('date') + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}` : "Select a Time"}
            </button>
        </form>
        <p className="text-sm text-gray-500">Time zone: Eastern Time - US & Canada</p>
    </>
}


function convertTime(date: any, time: any, addMinutes? : number) {
    const hours = parseInt(time.split(':')[0]);
    const minutes = parseInt(time.split(':')[1].slice(0, 2));
    const period = time.slice(-2).toUpperCase();
    const adjustedHours = period === 'PM' && hours !== 12 ? hours + 12 : period === 'AM' && hours === 12 ? 0 : hours;
    const dateObj = new Date(date);
    dateObj.setDate(dateObj.getDate() + 1); // Adjust to the next day
    dateObj.setHours(adjustedHours, minutes, 0, 0);
    if (addMinutes) {
        dateObj.setMinutes(dateObj.getMinutes() + addMinutes);
    }
    return dateObj;
}
