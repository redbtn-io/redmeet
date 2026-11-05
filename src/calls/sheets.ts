

export async function addToSheet(data: any) {
    try {
        const response = await fetch('https://api.redbtn.io/sheets', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        return result;
    } catch (error) {
        console.error('Error:', error);
    }


}