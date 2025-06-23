# codeviz-ai/backend/src/common/tracer.py
import sys
import json
import time # Ensure time is imported here
import inspect
import os
import io

# --- DEBUGGING PRINTS (These will go to the Docker container's stderr) ---
# Use sys.__stderr__ to bypass our own redirection
print("DEBUG: tracer.py started.", file=sys.__stderr__)
print(f"DEBUG: PYTHONUNBUFFERED={os.environ.get('PYTHONUNBUFFERED')}", file=sys.__stderr__)
print(f"DEBUG: sys.stdout type before redirection: {type(sys.stdout)}", file=sys.__stderr__)
# --- END DEBUGGING PRINTS ---

# Global list to store trace events
_trace_events = []
_frame_counter = 0
_frame_map = {} # Maps frame objects to unique IDs

def _get_frame_id(frame):
    """Generates a unique ID for a given frame."""
    global _frame_counter
    if frame not in _frame_map:
        _frame_map[frame] = f"frame_{_frame_counter}"
        _frame_counter += 1
    return _frame_map[frame]

def _get_variable_snapshot(frame):
    """Captures local variables from a frame, attempting to serialize them."""
    variables = {}
    for name, value in frame.f_locals.items():
        # Skip internal variables
        if name.startswith('__') and name.endswith('__'):
            continue
        try:
            # Attempt to serialize simple types, skip complex objects or use repr
            if isinstance(value, (int, float, str, bool, list, dict, tuple, type(None))):
                variables[name] = value
            else:
                # Use repr for complex objects to avoid serialization errors
                variables[name] = repr(value)
        except Exception:
            variables[name] = f"<unserializable object: {type(value).__name__}>"
    return variables

def _trace_function(frame, event, arg):
    """
    The main trace function called by sys.settrace.
    Captures detailed execution events.
    """
    global _trace_events

    # Filter out internal frames (e.g., from this tracer, or standard library)
    # Adjust this path filtering based on your project structure
    current_file = os.path.basename(frame.f_code.co_filename)
    # We only want to trace user_code.py
    if current_file != 'user_code.py':
        return _trace_function # Continue tracing in user code

    # Get a unique ID for the current frame
    frame_id = _get_frame_id(frame)

    # Common event data
    event_data = {
        'line_no': frame.f_lineno,
        'filename': current_file,
        'timestamp': time.time(),
        'frame_id': frame_id,
    }

    if event == 'line':
        # Capture variable state at each line
        event_data['event'] = 'line'
        event_data['variables'] = _get_variable_snapshot(frame)
        _trace_events.append(event_data)
    elif event == 'call':
        event_data['event'] = 'call'
        event_data['function_name'] = frame.f_code.co_name
        _trace_events.append(event_data)
    elif event == 'return':
        event_data['event'] = 'return'
        event_data['function_name'] = frame.f_code.co_name
        # Optionally, capture return value: event_data['return_value'] = arg
        _trace_events.append(event_data)
    elif event == 'exception':
        event_data['event'] = 'exception'
        event_data['exception_type'] = arg[0].__name__
        event_data['exception_value'] = str(arg[1])
        _trace_events.append(event_data)
    # 'c_call', 'c_return', 'c_exception' are for C functions, usually not needed for Python visualization

    return _trace_function # Always return the trace function itself

class Tracer:
    """
    A context manager for tracing Python code execution.
    """
    def __init__(self):
        global _trace_events, _frame_counter, _frame_map
        _trace_events = [] # Reset for each execution
        _frame_counter = 0
        _frame_map = {}

    def __enter__(self):
        sys.settrace(_trace_function)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        sys.settrace(None) # Disable tracing

# --- Main execution block ---
if __name__ == "__main__":
    # Read user code from the mounted file
    USER_CODE_PATH = '/mnt/user_code.py'
    try:
        with open(USER_CODE_PATH, 'r') as f:
            user_code = f.read()
    except FileNotFoundError:
        user_code = "" # Handle case where file might not be found
        print(f"ERROR: User code file not found at {USER_CODE_PATH}", file=sys.__stderr__)


    output_data = {
        "output": "",
        "error": None,
        "execution_trace": [],
        "execution_time": 0.0
    }

    old_stdout = sys.stdout
    old_stderr = sys.stderr
    sys.stdout = captured_stdout = io.StringIO()
    sys.stderr = captured_stderr = io.StringIO()

    print(f"DEBUG: sys.stdout type after redirection: {type(sys.stdout)}", file=sys.__stderr__)
    print("DEBUG: Attempting to execute user code.", file=sys.__stderr__)
    print(f"DEBUG: User code length: {len(user_code)}", file=sys.__stderr__)
    print(f"DEBUG: User code snippet: '{user_code[:50]}...'", file=sys.__stderr__)

    start_time = time.perf_counter()

    try:
        # Define the global namespace for exec()
        # Explicitly include __builtins__ and any modules the user code might need
        # This is more robust than relying solely on __builtins__ for imports
        exec_globals = {
            '__builtins__': __builtins__,
            'sys': sys,
            'os': os,
            'time': time, # NEW: Explicitly provide the time module
            # Add other common modules here if needed, e.g., 'math': math
        }
        exec(user_code, exec_globals, exec_globals) # Pass the prepared globals

        output_data["execution_trace"] = _trace_events
    except Exception as e:
        output_data["error"] = str(e)
        print(f"DEBUG: Exception during execution: {e}", file=sys.__stderr__)
    finally:
        end_time = time.perf_counter()
        output_data["execution_time"] = round(end_time - start_time, 4)

        # Restore stdout and stderr
        sys.stdout = old_stdout
        sys.stderr = old_stderr

        output_data["output"] = captured_stdout.getvalue()
        if captured_stderr.getvalue():
            if output_data["error"]:
                output_data["error"] += "\n" + captured_stderr.getvalue()
            else:
                output_data["error"] = captured_stderr.getvalue()

        print(f"DEBUG: Captured stdout content length: {len(output_data['output'])}", file=sys.__stderr__)
        print(f"DEBUG: Captured stdout content: '{output_data['output']}'", file=sys.__stderr__)
        print(f"DEBUG: Captured stderr content: '{captured_stderr.getvalue()}'", file=sys.__stderr__)
        print("DEBUG: tracer.py finished.", file=sys.__stderr__)

    print(json.dumps(output_data))
