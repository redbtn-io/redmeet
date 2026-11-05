import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import CalendarPicker from "./DatePicker";
import TimePicker from "./TimePicker";

const AppointmentPicker = ({ setLoading, setResults, loading, userDetails }: any) => {

  const { user, meeting } = useParams();
  const navigate = useNavigate();
  
  const [params, setParams] = useSearchParams();
  const date = params.get('date'); // YYYY-MM-DD
  const yearParam = date ? parseInt(date.split('-')[0]) : new Date().getFullYear();
  
  const monthParam = date ? parseInt(date.split('-')[1]) - 1 : new Date().getMonth();

  
  const [times, setTimes] = useState<any[]>([]);

  const [loadingWheel, setLoadingWheel] = useState<boolean>(false);

  const [year, setYear] = useState<number>(yearParam);
  const [month, setMonth] = useState<number>(monthParam);
  const [dates, setDates] = useState<{ date: string; isPast: boolean; weekday: string }[]>([]);

  const today = new Date();

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  useEffect(() => {
    const daysInMonth = getDaysInMonth(year, month);
    const firstDayOfMonth = (new Date(year, month, 1).getDay() + 6) % 7;
    const lastDayOfMonth = (new Date(year, month, daysInMonth).getDay() + 6) % 7;
    const datesArray = Array.from({ length: daysInMonth}, (_, i) => {
      const date = new Date(year, month, i + 1);
      const isPast = date < today && date.toDateString() !== today.toDateString();
      const isFutureBeyondTwoMonths = date > new Date(today.getFullYear(), today.getMonth() + 2, today.getDate());
      return { date: date.toISOString().split("T")[0], isPast: isPast || isFutureBeyondTwoMonths, weekday: date.toLocaleString('en-US', { weekday: 'short' }) };
    });

    let trailingEmptydays = Array.from({ length: firstDayOfMonth + 1 }, (_, i) => {
      const prevMonthDate = new Date(year, month, -i);
      return { date: prevMonthDate.toISOString().split("T")[0], isPast: prevMonthDate < today, weekday: prevMonthDate.toLocaleString('en-US', { weekday: 'short' }) };
    }).reverse();
    if (trailingEmptydays.length >= 7) {
      trailingEmptydays = [];
    }

    const loadingEmptydays = Array.from({ length: 5 - lastDayOfMonth }, (_, i) => {
      const nextMonthDate = new Date(year, month + 1, i + 1);
      const isFutureBeyondTwoMonths = nextMonthDate > new Date(today.getFullYear(), today.getMonth() + 2, today.getDate());
      return { date: nextMonthDate.toISOString().split("T")[0], isPast: isFutureBeyondTwoMonths, weekday: nextMonthDate.toLocaleString('en-US', { weekday: 'short' }) };
    });
 
    setDates([...trailingEmptydays, ...datesArray, ...loadingEmptydays]);
  }, [month]);

  useEffect(() => {
    if (!loading && userDetails) {
      const userMeetings = userDetails.meetings || [];
      const meetingExists = userMeetings.some((meet: any) => meet.link === meeting);
      if (!meetingExists) {
        navigate(`/${user}`);
      }
    }
  }, [meeting, userDetails]);

  return (<> 
  {meeting && <div className={`flex flex-col mx-auto bg-white rounded-lg space-y-4 md:shadow-xl md:mt-16 
      ${params.get('date') ? 'max-w-5xl' : 'max-w-[768px]'}`}>
        
        <div className="flex justify-center shadow-xl">
            <div 
            onClick={() => navigate(`/${user}`)}
            className="p-4 bg-[var(--primary-color)] text-white hover:bg-[var(--highlight-color)] 
            cursor-pointer w-full md:rounded-t-lg">
              ← Back to Meetings
            </div>
        </div>

        <div className="md:flex md:transition-[width] duration-500 ease-in-out transform px-2 space-x-4 space-y-4 rounded-md mt-2
         md:px-6 md:pb-0">

          {!loading && userDetails && <div className={`mx-auto mt-2 ${params.get('date') ? 'md:w-1/2' : ''}`}>
            <HeaderMessage {...{loading, userDetails, meeting:userDetails.meetings.filter(
                (meet: any) => meet.link === meeting
              )[0] 
            }}/> <br/>
            <CalendarPicker {...{ year, setYear, month, setMonth, dates, times, setTimes, loadingWheel, setLoadingWheel, params, setParams, meeting: userDetails.meetings.filter(
                (meet: any) => meet.link === meeting
              )[0] 
            }} />
          </div>}

          <div className={`flex md:transition-[width] duration-500 ease-in-out transform pb-6 md:max-h-[648px]
            ${params.get('date') ? "md:w-1/2 w-full md:pl-6" : "md:w-0 h-0"}`}>
              <TimePicker {...{ times, setTimes, setLoading, setResults, loadingWheel,
                  params, setParams, meeting: userDetails?.meetings.filter(
                    (meet: any) => meet.link === meeting
                  )[0]
              }} />
          </div>
        </div>
    </div>}
    
  </>);
};

export default AppointmentPicker;


function HeaderMessage({loading, userDetails, meeting}: any) {
  return (
    <div className="p-4 border rounded shadow-sm border-[var(--primary-color)] ]">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">
          {!loading && userDetails && userDetails.meetings && <>
            {meeting.name}
          </>}
        </h3>
        <p className="opacity-50 uppercase text-xs">Eastern Time</p>
      </div>
      <p className="text-sm text-gray-600 mt-2">
        {!loading && userDetails && meeting && meeting.description}
      </p>
    </div>
  );
}