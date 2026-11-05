
export async function getUser(user: string) {
    try {
        const response = await fetch(`https://api.redbtn.io/user?user=${user}`);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error:', error);
    }
}

export async function getLink(user: any) {
    try {
        if (!user || !user.email) return

        let token = await user.getIdToken() 

        const response = await fetch(`https://api.redbtn.io/link`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application',
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error:', error);
    }
}