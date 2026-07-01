export function Greeting() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return (
    <div className="text-center py-4 animate-fade-in">
      <h1 className="text-2xl font-semibold mb-1">
        {greeting}, <span className="gradient-text">Alex</span>
      </h1>
      <p className="text-fg-muted text-sm">InfiniteAI OS is ready to build, analyze and automate anything for you.</p>
    </div>
  );
}

