import sqlite3
import json
import argparse
import sys

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--db', required=True)
    parser.add_argument('--action', required=True, choices=['add', 'list', 'dismiss'])
    parser.add_argument('--type', choices=['alarm', 'reminder', 'timer'])
    parser.add_argument('--target_time')
    parser.add_argument('--label')
    parser.add_argument('--id', type=int)
    args = parser.parse_args()

    try:
        conn = sqlite3.connect(args.db)
        cursor = conn.cursor()
        
        # Ensure table exists
        cursor.execute('''
          CREATE TABLE IF NOT EXISTS scheduler_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT,
            target_time TEXT,
            label TEXT,
            active INTEGER DEFAULT 1
          )
        ''')
        conn.commit()

        if args.action == 'add':
            if not args.type or not args.target_time or not args.label:
                print(json.dumps({"success": False, "error": "Missing parameters for action 'add'"}))
                return
            cursor.execute(
                'INSERT INTO scheduler_items (type, target_time, label, active) VALUES (?, ?, ?, 1)',
                (args.type, args.target_time, args.label)
            )
            conn.commit()
            new_id = cursor.lastrowid
            print(json.dumps({
                "success": True,
                "message": f"Created {args.type} successfully.",
                "id": new_id
            }))

        elif args.action == 'list':
            cursor.execute('SELECT id, type, target_time, label, active FROM scheduler_items WHERE active = 1')
            rows = cursor.fetchall()
            schedules = []
            for r in rows:
                schedules.append({
                    "id": r[0],
                    "type": r[1],
                    "target_time": r[2],
                    "label": r[3],
                    "active": r[4]
                })
            print(json.dumps({
                "success": True,
                "schedules": schedules
            }))

        elif args.action == 'dismiss':
            if args.id is None:
                print(json.dumps({"success": False, "error": "Missing 'id' parameter for action 'dismiss'"}))
                return
            cursor.execute('UPDATE scheduler_items SET active = 0 WHERE id = ?', (args.id,))
            conn.commit()
            if cursor.rowcount > 0:
                print(json.dumps({
                    "success": True,
                    "message": f"Dismissed schedule ID {args.id}."
                }))
            else:
                print(json.dumps({
                    "success": False,
                    "error": f"No active schedule found with ID {args.id}."
                }))

        conn.close()
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }))

if __name__ == '__main__':
    main()
