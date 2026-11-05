

export default function BookingCard({key, meeting}: any) {

    const length = (new Date(meeting.end).getTime() - new Date(meeting.start).getTime()) / (1000 * 60);
    const start = new Date(meeting.start).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
    const end = new Date(meeting.end).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'}); 
    const date = new Date(meeting.start).toLocaleDateString([], {weekday: 'short', month: 'short', day: 'numeric'});
    
    return (
        <div className="bg-red-500 rounded-lg p-4 w-80 border-1 border-white relative h-42" key={key}>

          <div className="flex justify-between items-start mb-2">
            <span className="text-sm text-gray-100">{length} MIN</span>
            <button className="text-gray-100 hover:text-white">
                ⚙️
            </button>
          </div>
          <h3 className="text-lg font-semibold text-white mb-2 cursor-pointer">{meeting.event}</h3>

            <div className="mb-2 absolute bottom-4 right-4 left-4">
                <span className="text-sm text-gray-100 cursor-pointer">
                    {'📅 ' + date}
                </span>
                <span className="text-sm text-gray-100 float-right cursor-pointer">
                    {returnClock(start) + ' ' + start + ' - ' + end}
                </span>
            </div>

        </div>
      );
}



const clocks: { [key: string]: string } = {
    '1':'🕐',
    '1:30': '🕜',
    '2': '🕑',
    '2:30': '🕝',
    '3': '🕒',
    '3:30': '🕞',
    '4': '🕓',
    '4:30': '🕟',
    '5': '🕔',
    '5:30': '🕠',
    '6': '🕕',
    '6:30': '🕡',
    '7': '🕖',
    '7:30': '🕢',
    '8': '🕗',
    '8:30': '🕣',
    '9': '🕘',
    '9:30': '🕤',
    '10': '🕙',
    '10:30': '🕥',
    '11': '🕚',
    '11:30': '🕦',
    '12': '🕛',
    '12:30': '🕧'
}

function returnClock(time: string) {
    const [hour, minute] = time.split(':').map(Number);
    const closestTime = minute >= 30 ? `${hour}:${30}` : `${hour}`;
    return clocks[closestTime as keyof typeof clocks] || '🕛';
}

function Buttons() {

    return <div className="flex space-x-2">
    <button className="bg-red-700 hover:bg-red-600 text-white py-2 px-4 rounded flex items-center">
      View booking
      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 ml-1" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M12.293 5.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
      </svg>
    </button>
    <button className="bg-red-700 hover:bg-red-600 text-white py-2 px-4 rounded flex items-center">
      Share booking
      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 ml-1" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6 8a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm-2 5a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1z" clipRule="evenodd" />
      </svg>
    </button>
  </div>
}